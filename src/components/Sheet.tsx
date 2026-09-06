import { useEffect } from 'react'

interface SheetProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

/**
 * One component, four uses: ranked places, place detail, derivation,
 * precision (UX-SPEC §6). The overlay backdrop is `pointer-events: none` so
 * drags on the globe behind it still work — only the sheet body itself opts
 * back in. Forgetting that on any interactive child makes it silently
 * unclickable; see poc/reference/README.md's "interaction bugs" list.
 */
export function Sheet({ open, onClose, children }: SheetProps) {
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  return (
    <div className="void-sheet-overlay" aria-hidden={!open}>
      <div className={open ? 'void-sheet on' : 'void-sheet'} role="dialog" aria-modal="false">
        <button type="button" className="void-sheet-close" onClick={onClose}>
          CLOSE
        </button>
        <div className="void-sheet-inner">{children}</div>
      </div>
    </div>
  )
}
