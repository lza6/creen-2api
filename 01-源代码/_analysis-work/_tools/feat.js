// Feature extractor over split module bodies
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const INDEX = require(path.join(DIR, '_index.json'));

// Pull "signature" strings: library markers, i18n keys, api paths, component names
function analyze(body) {
  const f = {};
  const push = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };

  // 1) i18n keys: c3("a.b.c") or t("a.b.c")
  const keys = [];
  let m;
  const kRe = /\b([A-Za-z_$][\w$]*)\s*\(\s*["']([A-Za-z][\w]*(?:\.[\w{}$]+){1,5})["']/g;
  while ((m = kRe.exec(body)) !== null) push(keys, m[2]);
  f.i18nKeys = keys;

  // 2) api paths
  const paths = [];
  const pRe = /["'`](\/[A-Za-z0-9_\-\.\/{}:${}]{2,140})["'`]/g;
  while ((m = pRe.exec(body)) !== null) {
    const p = m[1];
    if (/^\/(api|v1|v2)\//.test(p) || /^\/(user|auth|login|register|integral|credits|model|project|comic|video|audio|prompt|task|generate|upload|pay|order|invite|daily|inspiration|explore|community)/.test(p)) push(paths, p);
  }
  // external urls
  const urls = [];
  const uRe = /["'`](https?:\/\/[^"'`\s]{4,140})["'`]/g;
  while ((m = uRe.exec(body)) !== null) push(urls, m[1]);
  f.paths = paths;
  f.urls = urls;

  // 3) library signatures
  const libs = [];
  const LIB = [
    [/\$\$typeof|react\.element|ReactCurrentOwner|__SECRET_INTERNALS/, 'React core'],
    [/useInsertionEffect|useSyncExternalStore/, 'React core'],
    [/\bcreateContext\b.*\breact\b|(?:^|[^\w])createContext\(/, 'React core'],
    [/react-dom|createRoot|hydrateRoot|ReactDOM/, 'react-dom'],
    [/framer-motion|createMotionComponent|visualElement|motionValue|dragControls|\.render\(\)/, 'framer-motion'],
    [/useFocusRing|useHover|usePress|PressResponder|useSelectableCollection|selectionManager|useLocale/, 'react-aria'],
    [/@react-stately|stately/, 'react-stately'],
    [/@heroui|HEROUI|heroui|useButton\b.*variant/, 'hero-ui'],
    [/@iconify|iconify|iconData|IconifyIcon/, 'iconify'],
    [/dayjs/i, 'dayjs'],
    [/\bmoment\b|\.format\(["']YYYY/, 'moment'],
    [/lottie|bodymovin/, 'lottie'],
    [/@tanstack\/react-query|QueryClient|useQueryClient|useMutation|useInfiniteQuery/, 'react-query'],
    [/zustand|createStore|useStore|createWithEqualityFn/, 'zustand'],
    [/axios|AxiosError|CanceledError/, 'axios'],
    [/__NEXT_DATA__|NextRouter|next\/router|next\/dist|useRouter/, 'Next.js'],
    [/\bzod\b|ZodError|z\.object|z\.string|safeParse/, 'zod'],
    [/nanoid|uuidv4|\buuid\b/, 'nanoid/uuid'],
    [/clsx|classnames/, 'clsx/classnames'],
    [/twMerge|tailwind-merge/, 'tailwind-merge'],
    [/react-hook-form|handleSubmit|register\(|useFormContext/, 'react-hook-form'],
    [/@radix-ui|radix/, 'radix-ui'],
    [/\bswiper\b|Swiper/, 'swiper'],
    [/i18next|changeLanguage|i18n\.t\(/, 'i18next'],
    [/react-markdown|remark|rehype/, 'react-markdown'],
    [/lucide/, 'lucide-icons'],
    [/marquee|Marquee/, 'react-fast-marquee'],
    [/Virtuoso|virtuoso/, 'react-virtuoso'],
    [/@floating-ui|floating-ui|autoUpdate/, 'floating-ui'],
    [/@use-gesture|useGesture/, 'use-gesture'],
    [/useMeasure|react-use-measure/, 'react-use-measure'],
    [/\bsonner\b|Toaster|toast\./, 'sonner'],
    [/@headlessui|headlessui/, 'headless-ui'],
    [/recharts|ResponsiveContainer/, 'recharts'],
    [/emoji-mart|emojiMart|EmojiButton/, 'emoji-mart'],
    [/@dnd-kit|DndContext|useDraggable/, 'dnd-kit'],
    [/react-colorful|HexColorPicker/, 'react-colorful'],
    [/@mui|material-ui|MuiButton/, 'mui'],
    [/antd|ant-design/, 'antd'],
    [/react-i18next/, 'react-i18next'],
    [/@vercel|vercel\/analytics/, 'vercel'],
    [/posthog|PostHog/, 'posthog'],
    [/sentry|Sentry/, 'sentry'],
    [/stripe/i, 'stripe'],
    [/supabase/i, 'supabase'],
    [/firebase/i, 'firebase'],
    [/google-analytics|gtag|GA_TRACKING/, 'google-analytics'],
    [/react-player|ReactPlayer/, 'react-player'],
    [/hls\.js|Hls\(/, 'hls.js'],
    [/qrcode|QRCode/, 'qrcode'],
    [/cropper|Cropper/, 'cropperjs'],
    [/@monaco-editor|monaco/, 'monaco-editor'],
    [/tiptap|ProseMirror/, 'tiptap'],
    [/quill|Quill/, 'quill'],
    [/react-syntax-highlighter|prism|Prism/, 'syntax-highlighter'],
    [/markdown-it|marked\(/, 'markdown'],
    [/mime|lodash|_\.debounce/, 'lodash'],
    [/immer|produce\(/, 'immer'],
    [/nprogress|NProgress/, 'nprogress'],
    [/js-cookie|Cookies\./, 'js-cookie'],
    [/next-auth|NextAuth|signIn\(/, 'next-auth'],
    [/jwt|jsonwebtoken|decodeToken/, 'jwt'],
    [/crypto-js|CryptoJS/, 'crypto-js'],
    [/jszip|JSZip/, 'jszip'],
    [/file-saver|saveAs/, 'file-saver'],
    [/xlsx|exceljs/, 'xlsx'],
    [/pdf|jsPDF/, 'pdf'],
    [/tailwind/i, 'tailwind'],
    [/react-transition-group|TransitionGroup|CSSTransition/, 'react-transition-group'],
    [/react-textarea-autosize|TextareaAutosize/, 'react-textarea-autosize'],
    [/react-modal|Modal\b/, 'modal'],
    [/uppy|Uppy/, 'uppy'],
    [/resize-observer|ResizeObserver/, 'resize-observer'],
    [/intersection-observer|IntersectionObserver/, 'intersection-observer'],
  ];
  for (const [re, name] of LIB) if (re.test(body)) push(libs, name);
  f.libs = libs;

  // 4) component names (PascalCase identifiers assigned/defined)
  const comps = [];
  const cRe = /\b([A-Z][A-Za-z0-9_$]{2,40})\b/g;
  const seen = {};
  while ((m = cRe.exec(body)) !== null) seen[m[1]] = (seen[m[1]] || 0) + 1;
  f.identifiers = seen;

  // 5) business fields
  const FIELDS = ['integral', 'credits', 'credit', 'coin', 'model', 'models', 'prompt', 'project',
    'comic', 'audio', 'video', 'image', 'user', 'login', 'register', 'subscription', 'subscribe',
    'plan', 'vip', 'order', 'payment', 'pay', 'invite', 'referral', 'task', 'job', 'aspectRatio',
    'resolution', 'style', 'character', 'scene', 'manga', 'anime', 'upload', 'generate', 'creation',
    'wallet', 'balance', 'points', 'sign', 'profile', 'avatar', 'nickname', 'history', 'favorite',
    'collect', 'share', 'download', 'publish', 'draft', 'explore', 'inspiration', 'community'];
  f.fields = FIELDS.filter(x => new RegExp('\\b' + x + '\\b').test(body));

  // 6) chinese text
  const zh = [];
  const zhRe = /["'`]([^"'`\n]{2,60})["'`]/g;
  while ((m = zhRe.exec(body)) !== null) if (/[一-鿿]/.test(m[1])) push(zh, m[1]);
  f.chinese = zh.slice(0, 40);

  // 7) ids: strings that look like API/query keys / redux action types
  const actions = [];
  const aRe = /["'`]([a-z][a-z0-9_\-]*\.[a-z0-9_\-\.]{2,60})["'`]/g;
  while ((m = aRe.exec(body)) !== null) push(actions, m[1]);
  f.dottedStrings = actions;

  return f;
}

const out = {};
for (const file in INDEX) {
  const sub = path.join(DIR, '_mod', file.replace('.js', ''));
  out[file] = { chunkId: INDEX[file].chunkId, modules: [] };
  for (const mod of INDEX[file].modules) {
    const body = fs.readFileSync(path.join(sub, `${mod.id}.js`), 'utf8');
    const f = analyze(body);
    out[file].modules.push({ id: mod.id, args: mod.args, bytes: mod.bytes, exports: mod.exports, feat: f });
  }
}
fs.writeFileSync(path.join(DIR, '_features.json'), JSON.stringify(out, null, 2));
console.log('WROTE _features.json');
console.log('total modules:', Object.values(out).reduce((a, b) => a + b.modules.length, 0));
