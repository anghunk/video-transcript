<div align="center">
  <img src="./public/logo.webp" alt="Video Transcript 字幕工作室" width="112" />
  <h1>Video Transcript</h1>
  <p><strong>字幕工作室</strong> · 浏览器里的本地视频字幕工作台</p>
  <p>
    <a href="https://video-transcript.zishu.me">在线体验</a>
    · <a href="https://github.com/anghunk/video-transcript/issues">问题反馈</a>
    · <a href="./LICENSE">MIT License</a>
  </p>
  <p>
    <strong>无需账号</strong>
    · <strong>无需上传</strong>
    · <strong>无水印</strong>
  </p>
</div>

<p align="center">
  <img src="./docs/workspace.png" alt="Video Transcript 字幕工作台" />
</p>

## 项目简介

Video Transcript（字幕工作室）是一款完全运行在浏览器中的视频字幕工具。导入本地 MP4 后，可以使用 Whisper 在本机识别语音，在时间轴上编辑字幕与时间点，统一设置字幕样式，并导出已经烧录字幕的 MP4。

所有视频、字幕和导出过程都在当前设备完成，不需要账号，也不会上传音视频。项目、字幕进度和视频缓存会保存在浏览器本地，适合反复修改和连续编辑。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 多项目管理 | 创建、搜索、打开、重命名和删除项目；视频缓存丢失时可重新关联原文件 |
| 本地视频导入 | 拖拽或选择 MP4，读取分辨率、时长、体积、视频编码与音轨信息 |
| 智能字幕识别 | 使用 Whisper 在本机识别音频，支持自动检测及中文、英语、日语、韩语 |
| 时间轴编辑 | 添加和删除字幕段，拖拽调整开始与结束时间，并与视频播放进度联动 |
| 实时字幕预览 | 字幕样式实时叠加在画面上，支持全屏预览，导出效果所见即所得 |
| 全局字幕样式 | 内置多套预设，可调整背景色、文字色、字号、不透明度、位置和对齐方式 |
| 多档 MP4 导出 | 提供接近原画、4K 上限和 1080p 上限三档画质，可保留原始 AAC 音轨 |
| 本地项目存储 | 使用 IndexedDB 保存项目、视频缓存、字幕和设置，并支持持久化存储 |
| 可安装 PWA | 支持安装到桌面，已加载的页面资源可通过 Service Worker 离线复用 |
| 双语与主题 | 支持中文和英文界面，以及深色和浅色主题 |

## 使用流程

1. 打开[在线体验](https://video-transcript.zishu.me)，或在浏览器中安装为 PWA。
2. 新建项目并选择本地 MP4，也可以直接拖入视频文件。
3. 需要自动生成字幕时，进入“智能识别”，选择模型和语言后开始识别。
4. 在时间轴中添加、删除和调整字幕段，并在右侧编辑文字与时间点。
5. 进入“字幕样式”统一设置字幕外观，通过视频预览确认画面效果。
6. 进入“导出”，选择画质与音轨选项，导出带字幕的 MP4。

项目页会按视频第 1 秒画面生成缩略图。项目较多时，可以按项目名或视频文件名搜索；删除项目时，对应的字幕数据和视频缓存也会一并删除。

## 本地语音识别

“智能识别”使用 Whisper 模型在本机完成推理。音频只在当前设备解码和识别，不会上传到服务器，也不依赖第三方识别接口。

- 模型来源：首次使用某个模型时，浏览器直接从 Hugging Face 官方源（`huggingface.co`）下载 ONNX 权重。
- 推理运行时：首次使用时从 jsDelivr 下载 ONNX Runtime Web 的 WASM 文件，之后由浏览器缓存复用。
- 本地缓存：模型保存在 Cache Storage 的 `transformers-cache` 缓存桶中，同一模型不会重复下载。
- 模型档位：快速（tiny）约 45-120 MB、均衡（base）约 80-205 MB、精准（small）约 245-565 MB，具体取决于运行方式。
- 运行方式：优先使用 WebGPU；浏览器不支持时会回退到 CPU（WASM）推理。
- 识别语言：支持自动检测、中文、英语、日语和韩语。
- 时间成本：长视频和更大的模型需要更长时间，识别期间请保持页面打开。

音频解码优先使用 WebCodecs 流式提取音轨，内存占用通常低于整段解码；浏览器不支持时会回退到 `decodeAudioData`，长视频对内存的要求会相应提高。

## 数据与隐私

- 视频、项目数据和字幕始终保留在当前浏览器中，导出结果由浏览器在本机生成后直接下载，不会上传到服务器。
- 语音识别完全在本机完成；首次使用时会访问 Hugging Face 下载模型，并从 jsDelivr 获取推理运行时。
- 项目数据使用 IndexedDB 保存，应用会申请持久化存储以降低被浏览器自动清理的概率。
- 项目页显示的“已用”仅统计当前应用保存在 IndexedDB 中的项目与视频数据。
- 清理浏览器站点数据会同时删除本地项目、视频缓存和语音识别模型。
- 超出浏览器存储配额时，字幕仍可保存，但视频缓存可能失败，下次打开项目需要重新关联原文件。

## 浏览器兼容性

推荐使用最新版桌面 Chrome 或 Edge。Safari 和部分移动浏览器可能缺少 WebCodecs、WebGPU 或 H.264 编码能力；当视频轨道无法解码或浏览器不支持导出时，界面会给出明确提示。

视频处理尽量留在本地，因此设备性能、浏览器版本和源视频编码会直接影响识别与导出成功率。推荐使用 H.264 视频轨道和 AAC 音轨。

## 视频规模与性能建议

应用没有设置固定的视频大小或时长上限，实际可用规模取决于设备内存、CPU、GPU 和视频编码。以下是桌面版 Chrome / Edge 的经验参考，并非硬性保证：

| 场景 | 建议 |
| --- | --- |
| 稳妥的日常使用 | 1080p、30fps、5-20 分钟，源文件 200 MB-1 GB |
| 16 GB 内存设备 | 1080p，建议不超过 30 分钟、源文件 1 GB 左右 |
| 32 GB 内存设备的极限尝试 | 1080p，可尝试 60 分钟、源文件 2 GB 左右；或 4K，20-30 分钟、2-4 GB |
| 不建议 | 源文件超过 2 GB、2 小时以上的 1080p、长时间 4K、8K，或移动端处理大文件 |

如果只需要预览和调整字幕，通常可以处理比导出更大的视频。长时间 4K 视频建议选择“标准”画质，将输出限制在 1080p，以提高导出成功率。

字幕烧录需要重新编码视频轨道，因此导出文件体积可能与原视频不同。导出码率默认参考源视频平均码率，再根据输出分辨率、源编码格式和画质档位调整，最高限制为 `80 Mbps`；缺少源码率信息时会按分辨率和帧率估算。

## 技术栈

- 前端：React 19、TypeScript、Vite
- 视频处理：WebCodecs、mp4box、mp4-muxer
- 本地识别：Transformers.js、ONNX Runtime Web、Whisper
- 本地存储：IndexedDB、Cache Storage
- 应用能力：i18next、Service Worker、Web App Manifest

## 本地开发

```bash
git clone https://github.com/anghunk/video-transcript.git
cd video-transcript
npm install
npm run dev
```

常用命令：

```bash
npm run dev      # 启动开发服务器
npm run build    # 类型检查并构建生产版本
npm run preview  # 预览生产构建
```

生产构建输出到 `dist/`。语音识别模型和 WebGPU 等能力需要通过 `localhost` 或 HTTPS 访问，不能直接双击 HTML 文件运行。

## 参与贡献

欢迎通过 [Issues](https://github.com/anghunk/video-transcript/issues) 提交问题和建议，也欢迎提交 Pull Request 改进功能、兼容性和文档。

## License

[MIT](./LICENSE)
