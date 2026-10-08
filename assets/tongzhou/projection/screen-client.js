// Local viewport extension for the pinned noVNC 1.7.0 client.
// Keep vendor code unmodified. Use Display.scale so RFB's absX/absY pointer
// conversion uses exactly the same scale as the visible canvas (not CSS zoom).
import RFB from './vendor/novnc/core/rfb.js';
const MIN_SCALE = 0.10;
const MAX_SCALE = 3;

export default class ProjectionScreenClient extends RFB {
    get viewportElement() { return this._screen; }
    get canvasElement() { return this._canvas; }
    get localScale() { return this._display?.scale || 1; }
    get panMode() { return Boolean(this._localPanMode); }
    set panMode(value) { this._localPanMode = Boolean(value); }

    _updateScale() {
        if (!this._display) return;
        if (!this._scaleViewport && Number.isFinite(this._localScale)) {
            this._display.scale = this._localScale;
            this._fixScrollbars();
        } else {
            super._updateScale();
        }
        this.dispatchEvent(new CustomEvent('localzoom', {
            detail:{scale:this.localScale, fit:this.scaleViewport}
        }));
    }

    setLocalScale(value, anchor) {
        if (!Number.isFinite(value)) return;
        const previousScale = this.localScale;
        const oldRect = this._canvas.getBoundingClientRect();
        const viewportRect = this._screen.getBoundingClientRect();
        const point = anchor || {
            x:viewportRect.left + viewportRect.width / 2,
            y:viewportRect.top + viewportRect.height / 2
        };
        const remoteX = (point.x - oldRect.left) / previousScale;
        const remoteY = (point.y - oldRect.top) / previousScale;
        this._localScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
        this.scaleViewport = false;
        this.clipViewport = false;
        this._updateScale();
        const rect = this._canvas.getBoundingClientRect();
        this._screen.scrollLeft += rect.left + remoteX * this.localScale - point.x;
        this._screen.scrollTop += rect.top + remoteY * this.localScale - point.y;
    }

    fitLocalViewport() {
        this._localScale = null;
        this._localPinch = null;
        this.scaleViewport = true;
        this.clipViewport = false;
        this._screen.scrollLeft = this._screen.scrollTop = 0;
    }

    _handleGesture(event) {
        const detail = event.detail;
        if (detail.type === 'pinch') {
            if (event.type === 'gesturestart') {
                this._localPinch = {
                    distance:Math.max(1, Math.hypot(detail.magnitudeX, detail.magnitudeY)),
                    scale:this.localScale
                };
            } else if (event.type === 'gesturemove' && this._localPinch) {
                const distance = Math.hypot(detail.magnitudeX, detail.magnitudeY);
                this.setLocalScale(this._localPinch.scale * distance / this._localPinch.distance,
                    {x:detail.clientX, y:detail.clientY});
            } else if (event.type === 'gestureend') {
                this._localPinch = null;
            }
            // noVNC normally maps pinch to remote Ctrl+wheel. Never change
            // the computer's native Codex font/zoom or send shortcuts for this gesture.
            return;
        }
        const overflow = this._screen.scrollWidth > this._screen.clientWidth + 1 ||
                         this._screen.scrollHeight > this._screen.clientHeight + 1;
        if ((detail.type === 'twodrag' && overflow) || this.panMode) {
            if (event.type === 'gesturestart') {
                this._localPan = {x:detail.clientX, y:detail.clientY,
                    left:this._screen.scrollLeft, top:this._screen.scrollTop};
            } else if (event.type === 'gesturemove' && this._localPan) {
                this._screen.scrollLeft = this._localPan.left + this._localPan.x - detail.clientX;
                this._screen.scrollTop = this._localPan.top + this._localPan.y - detail.clientY;
            } else if (event.type === 'gestureend') {
                this._localPan = null;
            }
            return;
        }
        super._handleGesture(event);
    }

    _handleMouse(event) {
        if (!this.panMode) return super._handleMouse(event);
        event.preventDefault();
        if (event.type === 'mousedown' && event.button === 0) {
            this._localMousePan = {x:event.clientX, y:event.clientY,
                left:this._screen.scrollLeft, top:this._screen.scrollTop};
        } else if (event.type === 'mousemove' && this._localMousePan && event.buttons & 1) {
            this._screen.scrollLeft = this._localMousePan.left + this._localMousePan.x - event.clientX;
            this._screen.scrollTop = this._localMousePan.top + this._localMousePan.y - event.clientY;
        } else if (event.type === 'mouseup') {
            this._localMousePan = null;
        }
    }

    _handleWheel(event) {
        if (event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            this.setLocalScale(this.localScale * Math.exp(-event.deltaY * 0.002),
                {x:event.clientX, y:event.clientY});
        } else if (this.panMode) {
            event.preventDefault();
            this._screen.scrollLeft += event.deltaX;
            this._screen.scrollTop += event.deltaY;
        } else {
            super._handleWheel(event);
        }
    }
}
