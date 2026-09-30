| 端点 | 状态码 | 认证 | 返回规模 |
|------|-------|------|---------|
| `/api/home/health` | 200 | 公开 | 对象:code,data,errorCode,fieldErrors,msg |
| `/api/home/banners` | 200 | 公开 | 12 项 |
| `/api/home/getFeaturesByCategory` | 200 | 公开 | 4 项 |
| `/api/home/getModelsByCategory` | 200 | 公开 | 2 项 |
| `/api/home/getAdsImageModels` | 200 | 公开 | 0 项 |
| `/api/aiImage/models` | 200 | 公开 | 20 项 |
| `/api/aiVideo/models` | 200 | 公开 | 37 项 |
| `/api/aiVideo/editModels` | 400 | 需参数 | 对象:code,data,errorCode,fieldErrors,msg |
| `/api/aiVideo/lipSyncModels` | 200 | 公开 | 3 项 |
| `/api/aiVideo/motionControlModels` | 200 | 公开 | 5 项 |
| `/api/aiVideo/motionControlTemplates` | 200 | 公开 | 20 项 |
| `/api/aiVideo/talkingAvatarModels` | 401 | **需认证** | 对象:code,fieldErrors,msg |
| `/api/aiComic/models` | 200 | 公开 | 对象:categories,featuresModels |
| `/api/aiComic/styles` | 200 | 公开 | 8 项 |
| `/api/aiComic/formats` | 200 | 公开 | 40 项 |
| `/api/audio/voiceTemplates` | 401 | **需认证** | 对象:code,fieldErrors,msg |
| `/api/audio/getLanguageForVoice` | 401 | **需认证** | 对象:code,fieldErrors,msg |
| `/api/auth/getAccount` | 401 | **需认证** | 对象:code,fieldErrors,msg |
| `/api/aiExplore/page` | 200 | 公开 | 对象:current,records,size,total |
