# Electron 桌面应用启动指南

## 快速开始（一键启动）

### Windows

双击运行：
```
start.bat
```

或在 PowerShell 中：
```powershell
npm run electron
```

### 开发模式（带 DevTools）
```powershell
npm run electron:dev
```

---

## 数据存储位置

所有数据默认存储在用户目录下：
```
C:\Users\<用户名>\LegalWorkbench\
├── data/
│   └── workbench.sqlite          # SQLite 主数据库
├── contracts/                    # 合同归档文件夹
│   └── 2026/
│       └── <合同ID>-<相对方>-<合同名>/
│           ├── versions/         # 各版本原始文件
│           ├── exports/          # 导出的红线/清洁稿
│           └── attachments/      # 附件
├── files/                        # 通用文件存储
└── backups/                      # 自动备份
```

可通过环境变量 `LEGAL_WORKBENCH_DATA_DIR` 修改存储位置。

---

## 核心功能

### 1. SQLite 持久化存储
- 替换原 JSON 文件存储，支持事务、索引、全文检索
- 每次前端同步自动保存到 SQLite
- 启动时自动从 SQLite 恢复数据

### 2. 合同文件夹归档
- 每个合同自动创建独立文件夹
- 上传版本文件自动归档到 `versions/` 子目录
- 导出文件自动保存到 `exports/` 子目录
- 支持通过 API 下载历史文件

### 3. 自动备份
- 每次关闭应用时自动创建 SQLite 备份
- 保留最近 20 个备份，自动清理旧备份
- 也可通过托盘菜单手动触发备份

### 4. 托盘运行
- 关闭窗口后应用在后台托盘继续运行
- 右键托盘图标：打开工作台 / 打开归档文件夹 / 立即备份 / 退出
- 点击托盘图标快速唤回窗口

### 5. 后端守护
- Electron 自动启动后端 Node.js 服务
- 后端崩溃自动重启（最多 5 次）
- 退出 Electron 时自动关闭后端

---

## 打包发布

### 打包为 Windows 安装程序
```powershell
npm run build:win
```
输出：`dist/AI合同审阅工作台 Setup.exe`

### 打包为便携版
输出：`dist/AI合同审阅工作台.exe`（绿色版，无需安装）

### 打包为 macOS DMG
```bash
npm run build:mac
```

---

## 技术架构变更

| 组件 | 变更前 | 变更后 |
|------|--------|--------|
| 存储 | `data/workbench-db.json` | `~/LegalWorkbench/data/workbench.sqlite` |
| 文件 | `data/files/`（平铺） | `~/LegalWorkbench/contracts/<合同>/`（结构化） |
| 启动 | `npm run server:ai` + 浏览器 | 双击 `start.bat` 或桌面图标 |
| 备份 | 无 | 自动 SQLite 备份，保留 20 份 |
| 后端 | 手动启动 | Electron 自动管理生命周期 |

---

## 新增 API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/contracts` | 列出所有合同及其归档路径 |
| GET | `/api/contracts/:id/files?type=` | 列出合同文件 |
| POST | `/api/contracts/:id/files` | 上传文件到合同归档 |
| POST | `/api/contracts/:id/exports` | 保存导出文件 |
| GET | `/api/files/:id/download` | 下载文件 |
| DELETE | `/api/files/:id` | 删除文件 |
| POST | `/api/backup` | 手动触发数据库备份 |

---

## 常见问题

**Q: 启动后白屏？**
A: 检查后端是否正常启动。查看控制台日志中的 `[Backend]` 输出。

**Q: 数据存在哪里？**
A: Windows 下默认在 `C:\Users\<用户名>\LegalWorkbench\`。

**Q: 如何迁移旧数据？**
A: 旧数据在 `data/workbench-db.json`。启动新版后，旧的前端 localStorage 数据会在首次打开时自动同步到 SQLite。

**Q: 如何更换数据目录？**
A: 设置环境变量 `LEGAL_WORKBENCH_DATA_DIR=D:\MyData`，然后重新启动。
