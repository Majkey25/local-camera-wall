import { VideoRTC } from '/video-rtc.js';

export const session = sessionStorage.getItem('kamery.session');

class CameraPlayer extends VideoRTC {
  constructor() {
    super();
    this.mode = 'mse';
    this.media = 'video';
    this.visibilityCheck = false;
    this.visibilityThreshold = 0;
    this.retries = 0;
  }

  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = true;
    this.video.setAttribute('aria-label', this.camera.name);
    const reportAspectRatio = () => {
      const { videoWidth, videoHeight } = this.video;
      if (videoWidth && videoHeight) {
        this.dispatchEvent(new CustomEvent('aspect-ratio', { detail: videoWidth / videoHeight }));
      }
    };
    this.video.addEventListener('loadedmetadata', reportAspectRatio);
    this.video.addEventListener('resize', reportAspectRatio);
    reportAspectRatio();
    this.video.addEventListener('playing', () => {
      this.retries = 0;
      this.showStatus('live');
    });
    this.video.addEventListener('waiting', () => {
      if (this.status !== 'live' || this.waitTimer) return;
      // MSE can briefly wait between fragments. Keep the last frame visible.
      this.waitTimer = setTimeout(() => {
        this.waitTimer = null;
        if (this.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) this.showStatus('buffering');
      }, 1000);
    });
  }

  onconnect() {
    if (!this.isConnected || !this.wsURL || this.ws) return false;
    this.wsState = WebSocket.CONNECTING;
    this.connectTS = Date.now();
    const socket = new WebSocket(this.wsURL, `kamery.${session}`);
    this.ws = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => this.onopen());
    socket.addEventListener('close', () => this.onclose());
    return true;
  }

  onopen() {
    const modes = super.onopen();
    this.onmessage.status = message => {
      if (message.type === 'error') this.showStatus(message.reason === 'credentials' ? 'credentials' : 'error');
    };
    if (!modes.length) this.showStatus('codec');
    return modes;
  }

  onclose() {
    if (this.wsState === WebSocket.CLOSED) return false;
    if (this.status === 'credentials' || this.status === 'codec' || this.retries >= 2) {
      this.wsState = WebSocket.CLOSED;
      this.ws = null;
      return false;
    }
    this.showStatus('error');
    this.retries++;
    return super.onclose();
  }

  connectedMoveCallback() {
    // Moving a tile does not change its stream.
  }

  disconnectedCallback() {
    clearTimeout(this.waitTimer);
    clearTimeout(this.reconnectTID);
    this.wsState = WebSocket.CLOSED;
    this.ws?.close();
    this.ws = null;
    if (!this.video) return;
    this.video.pause();
    if (this.video.src.startsWith('blob:')) URL.revokeObjectURL(this.video.src);
    this.video.removeAttribute('src');
    this.video.srcObject = null;
    this.video.load();
  }

  showStatus(status) {
    clearTimeout(this.waitTimer);
    this.waitTimer = null;
    if (this.status === status || !this.isConnected) return;
    this.status = status;
    this.dispatchEvent(new CustomEvent('playback', { detail: status }));
  }
}

customElements.define('camera-player', CameraPlayer);
