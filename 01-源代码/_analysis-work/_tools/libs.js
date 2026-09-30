// Deep library fingerprinting + distinctive-string dump per module
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const F = require(path.join(DIR, '_features.json'));
const INDEX = require(path.join(DIR, '_index.json'));

// Known distinctive markers for major libs (webpack-agnostic)
const MARKERS = [
  ['react-aria', /react-aria|useFocusRing|useHover\(|usePress\(|PressResponder|useSelectableCollection|useTableColumnResize|useTooltipTrigger|useNumberField|useDateField|useComboBox|useListBox|useMenu\b|useOverlay|useModal|useDialog|useRadio|useSlider|useSwitch|useTabs|useToolbar|useSearchField|useTextField|useToggleButton|useCheckbox|useSelect|useSpinButton|useCalendar|useDropZone|useFileTrigger|useLink\b|useBreadcrumbs|useDisclosure|useLandmark/],
  ['react-stately', /react-stately|useControlledState|useMultipleSelectionState|useSingleSelection|useTreeState|useListState|useMenuTriggerState|useOverlayTriggerState|Item\b.*collection|SelectionManager|createListCollection/],
  ['framer-motion', /framer-motion|createMotionComponent|VisualElement|visualElement|motionValue|dragControls|useDomEvent|useAnimationFrame|useIsPresent|usePresence|MotionConfig|LazyMotion|AnimationFeature|ProjectionNode|ScrollOffset|willChange|transformTemplate/],
  ['HERO UI / NextUI', /heroui|@heroui|nextui|__nextui|HeroUIProvider|useButton\(|(?:^|[^\w])Spinner\b|Avatar.*Group|Chip.*variant/],
  ['iconify', /@iconify|iconify|IconifyIcon|iconData|iconify-icon|addCollection|_iconifyData|api\.iconify\.design/],
  ['react', /\$\$typeof|REACT_ELEMENT_TYPE|ReactCurrentOwner|ReactCurrentDispatcher|ReactNoopUpdateQueue|react\.element|react\.fragment|react\.provider|react\.context|react\.forward_ref/],
  ['react-dom', /react-dom|ReactDOM|createRoot|hydrateRoot|ReactDOMServer|flushSync/],
  ['scheduler', /unstable_scheduleCallback|unstable_cancelCallback|unstable_shouldYield|requestIdleCallback.*timeout|scheduler/],
  ['next', /__NEXT_DATA__|next\/router|next\/dist|NextRouter|NEXT_ROUTER|_next\/static|__next/],
  ['dayjs', /dayjs/i],
  ['lodash', /lodash|isPlainObject|baseClone\b|baseGet\b|baseIteratee/],
  ['axios', /AxiosError|isAxiosError|AxiosHeaders|CanceledError|ERR_BAD_REQUEST/],
  ['react-query/tanstack', /@tanstack|QueryClient|useQueryClient|useMutationState|QueryObserver|focusManager|onlineManager|queryCache/i],
  ['zustand', /zustand|useStore\(|createStore\(|createWithEqualityFn|getState\(\)\.setState/],
  ['zod', /ZodError|parseAsync|safeParse|(?:^|[^\w])z\.object|_parse\(|ZodType/],
  ['clsx', /clsx|classnames|toVal.*typeof/],
  ['tailwind-merge', /twMerge|tailwind-merge|mergeClassNames/],
  ['react-hook-form', /useFormContext|handleSubmit|register\(|resolver|Controller\b|formState|react-hook-form/],
  ['radix-ui', /@radix-ui|radix|DismissableLayer|useControllableState|Portal\b.*primitive|createSlot/],
  ['floating-ui', /@floating-ui|floating-ui|autoUpdate|computePosition|offset\(.*flip/],
  ['swiper', /swiper|Swiper\b/],
  ['emoji-mart', /emoji-mart|emojiMart|EmojiButton|emojiData/],
  ['lottie', /lottie|bodymovin|animationData|LottieAnimation/],
  ['react-markdown', /react-markdown|remark|rehype|micromark|unified/],
  ['recharts', /recharts|ResponsiveContainer|CartesianGrid/],
  ['virtuoso', /Virtuoso|virtuoso|VirtuosoList/],
  ['sonner', /sonner|Toaster|(?:^|[^\w])toast\.(?:success|error|message)/],
  ['use-gesture', /@use-gesture|useGesture|GestureHandlers/],
  ['react-use-measure', /useMeasure|react-use-measure|ResizeObserver.*measures/],
  ['i18next/next-intl', /i18next|initReactI18next|changeLanguage|next-intl|createTranslator|useTranslations|getTranslations/],
  ['stripe', /stripe/i],
  ['supabase', /supabase/i],
  ['firebase', /firebase/i],
  ['posthog', /posthog|PostHog/i],
  ['sentry', /sentry|Sentry/i],
  ['GA/gtag', /gtag|google-analytics|googletagmanager|dataLayer/],
  ['qrcode', /qrcode|QRCode|qrCode/i],
  ['cropper', /cropper|Cropper/],
  ['tiptap', /tiptap|ProseMirror|prosemirror/],
  ['monaco', /monaco|MonacoEditor/],
  ['nprogress', /NProgress|nprogress/],
  ['js-cookie', /js-cookie|Cookies\.get|Cookies\.set/],
  ['next-auth', /next-auth|NextAuth|getServerSession|SessionProvider|signIn\(|useSession/],
  ['jwt', /jwt|jsonwebtoken|jwtDecode|decodeJwt/],
  ['crypto-js', /CryptoJS|crypto-js|AES\.encrypt|MD5\(/],
  ['jszip', /JSZip|jszip/],
  ['file-saver', /saveAs|file-saver/],
  ['mime-types', /mime-types|mimeType|lookup\(.*mime/],
  ['react-player', /react-player|ReactPlayer/],
  ['hls.js', /hls\.js|Hls\(|HlsConfig|LevelDetails/],
  ['hls.js-2', /isSupported\(\)|fragLoading|playlistLoader/],
  ['video.js', /videojs|video\.js/],
  ['wavesurfer', /wavesurfer|WaveSurfer/],
  ['howler', /Howler|howler/],
  ['react-dropzone', /useDropzone|react-dropzone/],
  ['react-colorful', /react-colorful|HexColorPicker/],
  ['react-tooltip', /react-tooltip/],
  ['popper', /popper|Popper\.js/],
  ['uiw/react-md-editor', /MDEditor|@uiw/],
  ['uuid', /uuidv4|generateUUID|v4\(\)/],
  ['nanoid', /nanoid|urlAlphabet/],
  ['immer', /immer|produce\(|draft\(|enablePatches/],
  ['react-syntax-highlighter', /react-syntax-highlighter|prism|hljs|highlight\.js/],
  ['marked/markdown', /marked\(|markdown-it|MarkdownIt/],
  ['dnd-kit', /@dnd-kit|DndContext|useDraggable|useDroppable|closestCenter|PointerSensor/],
  ['msw', /msw|mswjs|setupWorker/],
  ['react-joyride', /joyride|Joyride/],
  ['cookie', /cookie|CookieJar/],
  ['ua-parser', /UAParser|ua-parser/],
  ['bowser', /Bowser|bowser/],
  ['react-device-detect', /isMobile|isIOS|isAndroid|react-device-detect/],
  ['react-hot-toast', /react-hot-toast|hotToast/],
  ['react-icons', /react-icons|Fa[A-Z]\w+.*Icon|AiOutline/],
  ['intl/formatjs', /formatjs|IntlMessageFormat|intl-messageformat/],
];

function mark(body) {
  const hit = [];
  for (const [name, re] of MARKERS) if (re.test(body)) hit.push(name);
  return hit;
}

const out = {};
for (const file in F) {
  out[file] = [];
  for (const mod of F[file].modules) {
    const body = fs.readFileSync(path.join(DIR, '_mod', file.replace('.js',''), mod.id + '.js'), 'utf8');
    out[file].push({ id: mod.id, bytes: mod.bytes, libs: mark(body), exports: mod.exports });
  }
}
fs.writeFileSync(path.join(DIR, '_libs.json'), JSON.stringify(out, null, 2));

// Aggregate: for each file, top libs by module count
console.log('=== FILE -> LIBRARY SIGNATURE COUNTS ===');
for (const file in out) {
  const counts = {};
  for (const m of out[file]) for (const l of m.libs) counts[l] = (counts[l]||0)+1;
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  console.log(`\n## ${file} (${out[file].length} modules)`);
  console.log('   ' + sorted.map(([k,v])=>`${k}:${v}`).join(', '));
}
