# Local Camera Wall

A Windows dashboard for live video from up to 24 RTSP cameras on a private network. Arrange and resize the feeds in a live mosaic. The React interface is in Czech.

## Run on Windows

Install Node.js 24 or later on Windows x64. From the project directory, run these commands in PowerShell.

```powershell
npm ci --ignore-scripts
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\setup.ps1
.\start.cmd
```

Setup downloads the pinned Windows build of [go2rtc](https://github.com/AlexxIT/go2rtc) and checks its SHA-256 digest. `start.cmd` builds the interface locally, starts the dashboard, and opens it in your browser. Use an up-to-date Chrome or Edge for playback and continuous video while rearranging. Press Ctrl+C in the terminal to stop the app. If the app is already running, open `%LOCALAPPDATA%\Kamery\open.html` in the browser to reconnect.

## Add a camera

Select **Přidat kameru**. Enter a name, the RTSP URL, and the camera account in the separate username and password fields. Replace `CAMERA_IP` below with the camera's actual private IPv4 address.

| Camera | Example RTSP address |
| --- | --- |
| Imou / Dahua | `rtsp://CAMERA_IP:554/cam/realmonitor?channel=1&subtype=0` |
| Reolink | `rtsp://CAMERA_IP:554/Preview_01_sub` |
| TP-Link Tapo | `rtsp://CAMERA_IP:554/stream1` |

Use an H.264 stream if the browser cannot play the main stream. Some Reolink cameras require RTSP to be enabled in their server settings. Compatible Tapo cameras require a separate camera account, and most battery models do not offer RTSP. [Reolink RTSP guide](https://support.reolink.com/articles/900000630706-Introduction-to-RTSP/) · [TP-Link RTSP guide](https://www.tp-link.com/us/support/faq/2680/)

Select **Upravit rozložení** to reveal the handles. Drag the grip onto another camera to move that feed to its position. Drag the lower-right corner to change its size. The camera's **•••** menu also has a position selector and a size slider you can use with the keyboard or without dragging. The browser saves both position and size. **Resetovat rozložení** restores the original order and equal sizes. **Celá obrazovka** opens one feed fullscreen and **Upravit kameru** edits or removes it.

## Local access

The dashboard listens on IPv4 loopback port 8476. A launcher in your Windows profile authenticates the browser tab. The video service requires its own authentication on loopback port 8477. The browser streams from the dashboard without a cloud service. Camera streams use RTSP on your network, so use a trusted LAN and keep camera ports off the public internet.

Camera settings live in `%LOCALAPPDATA%\Kamery\cameras.json`. The profile folder grants access to the current Windows user and SYSTEM. Windows DPAPI encrypts the camera passwords for the current Windows user. A program running as that user can still access the camera or local dashboard.

## Development

Run `npm ci --ignore-scripts`, `npm run build`, and `npm test` on Windows. The tests exercise layout changes, address validation, Windows credential protection, and persistence using temporary data.
