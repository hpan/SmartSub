import { useEffect, useCallback } from 'react';

// 当前是否还有「会锁 body」的 Radix 浮层处于打开状态
const hasOpenRadixOverlay = (): boolean =>
  !!document.querySelector(
    '[data-state="open"][role="dialog"],' +
      '[data-state="open"][role="alertdialog"],' +
      '[data-radix-popper-content-wrapper]',
  );

/**
 * 兜底修复 Radix 已知问题：body 的 pointer-events: none 锁可能未被还原
 */
export function useRadixPointerEventsGuard(): void {
  // 强制清除 body 的 pointer-events 锁
  const forceRestore = useCallback(() => {
    const body = document.body;
    if (body.style.pointerEvents === 'none' && !hasOpenRadixOverlay()) {
      body.style.pointerEvents = '';
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;

    // 延后到下一帧检查
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(forceRestore);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(body, {
      attributes: true,
      attributeFilter: ['style'],
      childList: true,
      subtree: true,
    });

    // 每秒检查一次，更频繁地修复问题
    const intervalId = setInterval(forceRestore, 1000);

    // 在点击事件时也检查
    const clickHandler = () => {
      requestAnimationFrame(forceRestore);
    };
    document.addEventListener('click', clickHandler, true);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      clearInterval(intervalId);
      document.removeEventListener('click', clickHandler, true);
    };
  }, [forceRestore]);
}
