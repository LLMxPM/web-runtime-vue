/**
 * 文件用途：管理 Runtime 可视化编辑选区的多目标 fixed 覆盖层与滚动/缩放跟踪。
 */

export interface VisualEditSelectionOverlay {
  show(targets: Element[]): void
  clear(): void
  dispose(): void
}

/** 创建不触碰业务元素 class/style 的多目标选区覆盖层。 */
export function createSelectionOverlay(
  runtimeWindow: Window,
  runtimeDocument: Document,
): VisualEditSelectionOverlay {
  let targets: Element[] = []
  let overlays: HTMLDivElement[] = []
  let tracking = false

  const update = (): void => {
    targets.forEach((target, index) => {
      const overlay = overlays[index]
      if (!overlay || !target.isConnected) return
      const rect = target.getBoundingClientRect()
      overlay.style.left = `${rect.left}px`
      overlay.style.top = `${rect.top}px`
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`
    })
  }
  const startTracking = (): void => {
    if (tracking) return
    tracking = true
    runtimeWindow.addEventListener('resize', update)
    runtimeDocument.addEventListener('scroll', update, true)
  }
  const stopTracking = (): void => {
    if (!tracking) return
    tracking = false
    runtimeWindow.removeEventListener('resize', update)
    runtimeDocument.removeEventListener('scroll', update, true)
  }
  const clear = (): void => {
    targets = []
    overlays.forEach(overlay => overlay.remove())
    overlays = []
    stopTracking()
  }

  return {
    show(nextTargets: Element[]): void {
      targets = nextTargets
      while (overlays.length < targets.length) {
        const overlay = runtimeDocument.createElement('div')
        overlay.setAttribute('aria-hidden', 'true')
        Object.assign(overlay.style, {
          position: 'fixed',
          pointerEvents: 'none',
          boxSizing: 'border-box',
          border: '2px solid #2563eb',
          borderRadius: '2px',
          zIndex: '2147483647',
        })
        runtimeDocument.body.appendChild(overlay)
        overlays.push(overlay)
      }
      while (overlays.length > targets.length) overlays.pop()?.remove()
      update()
      startTracking()
    },
    clear,
    dispose: clear,
  }
}
