import { VideoRTC } from '/video-rtc.js';

export const session = sessionStorage.getItem('kamery.session');

const checkInterval = 2000;
const startupTimeout = 20_000;
const stalledTimeout = 12_000;

class CameraPlayer extends VideoRTC {
  constructor() {
    super();
    this.mode = 'mse';
    this.media = 'video';
    this.visibilityCheck = false;
    this.visibilityThreshold = 0;
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
      if (!this.ws) return;
      if (this.status === 'loading') this.lastProgress = performance.now();
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
    if (!this.isConnected || !this.wsURL || this.ws || this.failed) return false;
    this.wsState = WebSocket.CONNECTING;
    const socket = new WebSocket(this.wsURL, `kamery.${session}`);
    this.ws = socket;
    socket.binaryType = 'arraybuffer';
    // The inherited MSE handler can still receive queued data after close.
    socket.addEventListener('message', event => {
      if (this.ws !== socket) event.stopImmediatePropagation();
    });
    socket.addEventListener('open', () => {
      if (this.ws === socket) this.onopen();
    });
    socket.addEventListener('close', () => {
      if (this.ws === socket) this.fail('error');
    });
    this.lastTime = this.video.currentTime;
    this.lastProgress = performance.now();
    this.watchTimer = setInterval(() => this.checkPlayback(), checkInterval);
    this.showStatus('loading');
    return true;
  }

  onopen() {
    const modes = super.onopen();
    if (!modes.length) {
      this.fail('codec');
      return modes;
    }
    const onMedia = this.onmessage.mse;
    const MediaSource = window.ManagedMediaSource ?? window.MediaSource;
    this.onmessage.mse = message => {
      if (message.type === 'mse' && !MediaSource.isTypeSupported(message.value)) this.fail('codec');
      else onMedia(message);
    };
    this.onmessage.status = message => {
      if (message.type === 'error') this.fail(message.reason === 'credentials' ? 'credentials' : 'error');
    };
    return modes;
  }

  checkPlayback() {
    if (document.hidden) return;
    const now = performance.now();
    const time = this.video.currentTime;
    if (time !== this.lastTime) {
      this.lastTime = time;
      this.lastProgress = now;
      if (this.status === 'buffering' && !this.video.paused
        && this.video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) this.showStatus('live');
      return;
    }
    const elapsed = now - this.lastProgress;
    const timeout = this.status === 'loading' ? startupTimeout : stalledTimeout;
    if (elapsed >= timeout) this.fail('error');
    else if (this.status === 'live' && elapsed >= checkInterval * 2) this.showStatus('buffering');
  }

  fail(status) {
    this.failed = true;
    this.closeConnection();
    this.showStatus(status);
  }

  connectedMoveCallback() {
    // Moving a tile does not change its stream.
  }

  closeConnection() {
    clearTimeout(this.waitTimer);
    this.waitTimer = null;
    clearInterval(this.watchTimer);
    const socket = this.ws;
    this.ws = null;
    this.wsState = WebSocket.CLOSED;
    socket?.close();
  }

  disconnectedCallback() {
    this.closeConnection();
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
