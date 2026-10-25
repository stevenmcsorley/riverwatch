// Keep the current image visible until its replacement has loaded. At most two
// tile grids exist: visible + requested, or visible + the next playback frame.
export class RadarPlayback {
  constructor(makeLayer, onState) {
    this.makeLayer = makeLayer; this.onState = onState; this.layers = new Map();
    this.displayed = null; this.target = null; this.stateKey = '';
  }
  update({ frames, index, opacity, playing, host }) {
    this.frames = frames; this.index = Math.max(0, Math.min(index, frames.length - 1));
    this.opacity = opacity; this.playing = playing; this.host = host;
    this.target = frames[this.index]?.path;
    if (!this.target) return;
    const next = playing && this.layers.get(this.target)?.loaded && !this.layers.get(this.target)?.error ? frames[(this.index + 1) % frames.length]?.path : null;
    this.trim(new Set([this.displayed, this.target, next]));
    const record = this.ensure(frames[this.index]);
    if (record.loaded && !record.error) this.show(this.target);
    else this.report(record.error ? 'error' : 'loading');
    this.reconcile();
  }
  report(status) {
    const key = `${status}:${this.displayed}:${this.target}`;
    if (key !== this.stateKey) { this.stateKey = key; this.onState({ status, path: this.displayed, requestedPath: this.target }); }
  }
  ensure(frame) {
    if (this.layers.has(frame.path)) return this.layers.get(frame.path);
    const record = { layer: null, loaded: false, error: false };
    this.layers.set(frame.path, record);
    record.layer = this.makeLayer(`${this.host}${frame.path}/512/{z}/{x}/{y}/2/1_0.png`, {
      loading: () => {
        record.loaded = false; record.error = false;
        if (frame.path === this.target) this.report('loading');
      },
      tileerror: () => { record.error = true; if (frame.path === this.target) this.report('error'); },
      load: () => {
        record.loaded = true;
        if (frame.path === this.target) {
          if (!record.error) this.show(frame.path); else this.report('error');
          this.reconcile();
        }
      },
    });
    // The first frame can appear progressively; subsequent frames are buffered.
    record.layer.setOpacity(this.displayed === null && frame.path === this.target ? this.opacity : 0);
    record.layer.add();
    return record;
  }
  show(path) { this.displayed = path; this.report('ready'); }
  reconcile() {
    const target = this.layers.get(this.target);
    const next = this.playing && target?.loaded && !target.error && this.frames.length > 1 ? this.frames[(this.index + 1) % this.frames.length] : null;
    this.trim(new Set([this.displayed, this.target, next?.path]));
    if (next) this.ensure(next);
    for (const [path, record] of this.layers) record.layer.setOpacity(path === this.displayed || (!this.displayed && path === this.target) ? this.opacity : 0);
  }
  trim(keep) {
    for (const [path, record] of this.layers) if (!keep.has(path)) { record.layer.remove(); this.layers.delete(path); }
  }
  destroy() { for (const record of this.layers.values()) record.layer.remove(); this.layers.clear(); }
}
