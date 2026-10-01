# 声音的房间 · Sound Room

> 不是按钮列表，而是一间等距像素古堡图书馆——房间里每个物件都是一条声轨，点击它，房间就活过来。

**在线体验**：https://luwen668.github.io/sound-room/

## 玩法

- **点击物件**开关声音：木窗（雨声）、壁炉（柴火噼啪）、茶炉（沸水咕嘟）、烛台（烛火轻响）、猫（呼噜）、落地钟（滴答）
- **悬停 + 滚轮**调节单轨音量
- **🎚 混音台**（底部上滑面板）：六轨推子 + 四个预设配方（专注 / 助眠 / 阅读 / 深夜）
- **定时**：15 / 30 / 60 分钟或**自定义时长**，最后一分钟声音与画面一起渐弱，到点全部关闭
- 开窗听雨时，**随机雷声**会带着闪电照亮整个房间
- **分享**：地址栏链接实时编码房间状态，点「分享」复制发给朋友，打开即复现你的房间
- 刷新页面自动恢复上次的房间（localStorage）

## 本地运行

静态页面，任意 HTTP 服务器即可（音频素材受 file:// 跨域限制，不要直接双击打开）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000/sound-room/
```

## 技术

- 零依赖、零构建：原生 Canvas 2D 三图层（场景 / 粒子 / 光照打孔）+ Web Audio API
- 等距投影拼贴 Kenney CC0 素材；猫、落地钟、烛火、火焰为代码手绘
- 呼噜 / 咕嘟 / 烛火 / 雷声 / 滴答全部为 Web Audio 实时合成
- 设计文档见 [design-doc.md](design-doc.md)

## 素材致谢

- 美术：[Kenney](https://kenney.nl) Isometric Miniature / Dungeon 包，CC0 1.0
- 音频：雨声 Ogrebane、壁炉 PagDev（OpenGameArt，CC0）
- 完整清单与授权链接：[assets/audio/CREDITS.md](assets/audio/CREDITS.md)
