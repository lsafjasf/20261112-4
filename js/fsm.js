import { clamp, round6, STATE_IDS } from './util.js';
import { defaultConfig } from './defaults.js';

export class AnimationFSM {
  constructor(config = defaultConfig()) {
    this.config = config;
    this.time = 0;
    this.state = 'idle';
    this.clipTime = 0;
    this.prevState = null;
    this.prevClipTime = 0;
    this.transition = null;
    this.velocity = 0;
    this.x = 0;
    this.moving = false;
    this.pendingMove = false;
    this.frame = 0;
    this.prevFrame = -1;
    this.frameTime = 0;
    this.events = [];
    this._nextEventIndex = 0;
    this.enterState('idle', 0, true);
  }

  get st() {
    return this.config.states[this.state];
  }

  get blend() {
    if (!this.transition) return 1;
    return clamp(this.transition.elapsed / this.transition.duration, 0, 1);
  }

  get attackPhase() {
    if (this.state !== 'attack' || !this.st) return null;
    const f = this.frame;
    if (f < this.st.chargeFrames) return 'charge';
    if (f < this.st.chargeFrames + this.st.strikeFrames) return 'strike';
    return 'recovery';
  }

  pushEvent(type, detail) {
    this.events.push({ t: round6(this.time), type, ...detail });
  }

  input(name) {
    if (name === 'moveStart') {
      this.moving = true;
      if (this.state === 'attack') {
        if (this.attackPhase === 'recovery') this.transitionTo('move', 'move-interrupt-attack');
        else this.pendingMove = true;
      } else if (this.state !== 'move') {
        this.transitionTo('move', 'move-start');
      }
      return;
    }
    if (name === 'moveEnd') {
      this.moving = false;
      this.pendingMove = false;
      if (this.state === 'move') this.transitionTo('idle', 'move-end');
      return;
    }
    if (name === 'attack') {
      if (this.state === 'attack') return;
      this.pendingMove = this.state === 'move' ? this.moving : false;
      this.transitionTo('attack', 'attack-start');
      return;
    }
    if (name === 'hit') {
      if (this.state === 'attack' && this.attackPhase === 'charge') {
        this.pushEvent('hitBlocked', { state: this.state, phase: 'charge' });
        return;
      }
      this.transitionTo('hit', 'hit-interrupt-' + this.state);
      return;
    }
    throw new Error('未知输入: ' + name);
  }

  transitionTo(target, reason) {
    if (!STATE_IDS.includes(target)) throw new Error('未知目标状态: ' + target);
    const duration = target === this.state ? 0 : this.config.states[target].transition / 1000;
    this.pushEvent('transition', { from: this.state, to: target, reason });
    if (duration <= 0) {
      this.enterState(target, 0);
      this.transition = null;
      return;
    }
    this.prevState = this.state;
    this.prevClipTime = this.clipTime;
    this.state = target;
    this.clipTime = 0;
    this._nextEventIndex = 0;
    this.velocity = 0;
    this.transition = { duration, elapsed: 0 };
  }

  enterState(id, at = 0, initial = false) {
    this.prevState = initial ? null : this.state;
    this.state = id;
    this.clipTime = at;
    this.frameTime = 0;
    this.frame = 0;
    this.prevFrame = -1;
    this.velocity = 0;
    this._nextEventIndex = 0;
    if (id === 'move' && !this.moving) {
      this.enterState('idle', 0);
      return;
    }
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('dt 必须是非负数字');
    if (dt === 0) return this.snapshot();
    this.time += dt;
    const st = this.st;
    if (this.transition) {
      this.transition.elapsed += dt;
      this.advanceClip(dt, true);
      if (this.transition.elapsed >= this.transition.duration) {
        this.transition = null;
        this.prevState = null;
      }
    } else {
      this.advanceClip(dt, false);
    }
    const speed = this.intendedSpeed();
    if (this.transition && this.prevState) {
      const prevSpeed = this.config.states[this.prevState].moveSpeed *
        (this.prevState === 'move' ? (this.moving ? 1 : 0) : 1);
      this.velocity = prevSpeed * (1 - this.blend) + speed * this.blend;
    } else {
      this.velocity = speed;
    }
    this.velocity = round6(this.velocity);
    this.x = round6(this.x + this.velocity * dt);
    if (this.state === 'attack') this.evaluateAttackRules();
    return this.snapshot();
  }

  intendedSpeed() {
    const speed = this.st.moveSpeed;
    if (this.state === 'move') return this.moving ? speed : 0;
    return speed;
  }

  advanceClip(dt, inTransition) {
    const st = this.st;
    const before = this.clipTime;
    const clipDuration = st.frameCount / st.fps;
    this.clipTime += dt;
    this.frameTime += dt;
    const frameLen = 1 / st.fps;
    let f = Math.floor(this.clipTime / frameLen);
    let wrapped = false;
    if (st.loop) {
      f = f % st.frameCount;
      if (this.clipTime >= clipDuration) {
        this.clipTime %= clipDuration;
        wrapped = true;
      }
    } else if (f >= st.frameCount) {
      f = st.frameCount - 1;
      this.clipTime = clipDuration;
    }
    if (f !== this.frame) {
      this.pushEvent('frame', {
        state: this.state,
        frame: f,
        from: this.frame,
      });
      this.frame = f;
    }
    this.fireClipEvents(before, wrapped, inTransition);
    if (!st.loop && !inTransition && this.clipTime >= clipDuration - 1e-12) {
      this.onClipComplete();
    }
  }

  fireClipEvents(before, wrapped, inTransition) {
    const st = this.st;
    const clipDuration = st.frameCount / st.fps;
    const list = st.events;
    for (let i = this._nextEventIndex; i < list.length; i++) {
      const at = list[i].at * clipDuration;
      if (this.clipTime >= at && (wrapped || at > before || before === 0 && at === 0)) {
        this.pushEvent('sfx', { state: this.state, id: list[i].id, sfx: list[i].sfx, at: list[i].at });
        this._nextEventIndex = i + 1;
      }
    }
    if (wrapped) this._nextEventIndex = 0;
    if (inTransition) {
      this._nextEventIndex = Math.max(this._nextEventIndex, 0);
    }
  }

  onClipComplete() {
    if (this.state === 'attack' && this.pendingMove && this.moving) {
      this.pendingMove = false;
      this.transitionTo('move', 'attack-finish-pending-move');
      return;
    }
    if (this.state === 'hit' || this.state === 'attack') {
      this.transitionTo('idle', 'clip-complete');
    }
  }

  evaluateAttackRules() {
    const phase = this.attackPhase;
    if (phase === 'recovery' && this.pendingMove && this.moving) {
      this.pendingMove = false;
      this.transitionTo('move', 'recovery-move-interrupt');
    }
  }

  snapshot() {
    const st = this.st;
    return {
      t: round6(this.time),
      state: this.state,
      prevState: this.prevState,
      frame: this.frame,
      clipTime: round6(this.clipTime),
      blend: round6(this.blend),
      phase: this.attackPhase,
      moving: this.moving,
      pendingMove: this.pendingMove,
      x: this.x,
      velocity: round6(this.velocity),
      inTransition: Boolean(this.transition),
      frameCount: st.frameCount,
      fps: st.fps,
    };
  }
}
