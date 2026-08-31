import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
HTMLMediaElement.prototype.play = vi.fn(async function (this: HTMLMediaElement) {
  Object.defineProperty(this, 'paused', { configurable: true, value: false });
  this.dispatchEvent(new Event('play'));
});
HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
  Object.defineProperty(this, 'paused', { configurable: true, value: true });
  this.dispatchEvent(new Event('pause'));
});
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  drawImage: vi.fn(),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,dGVzdA==');
