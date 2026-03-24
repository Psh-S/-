# 如何将此项目打包为安卓 APK

本项目已经配置了 **Capacitor**，您可以按照以下步骤在本地环境中将其打包为安卓应用：

### 1. 环境准备
确保您的电脑已安装：
- **Node.js** (v16+)
- **Android Studio**
- **Java JDK 17**

### 2. 构建 Web 项目
在项目根目录下运行：
```bash
npm run build
```

### 3. 初始化安卓平台
如果您是第一次打包，请运行：
```bash
npx cap add android
```

### 4. 同步代码到安卓工程
每当您修改了前端代码并运行 `npm run build` 后，都需要运行：
```bash
npx cap sync
```

### 5. 在 Android Studio 中打开并打包
运行以下命令打开 Android Studio：
```bash
npx cap open android
```
在 Android Studio 中：
1. 等待 Gradle 同步完成。
2. 点击顶部菜单栏的 **Build** -> **Build Bundle(s) / APK(s)** -> **Build APK(s)**。
3. 打包完成后，右下角会弹出提示，点击 **locate** 即可找到生成的 `.apk` 文件。

### 注意事项
- **Gemini API Key**: 打包后的应用需要能够访问网络才能使用 Gemini AI 功能。
- **图标与名称**: 您可以在 `capacitor.config.ts` 中修改 `appName`，在 Android Studio 中修改应用图标。
