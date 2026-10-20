/**
 * Open the print dialog once the document's images have actually arrived.
 *
 * The first version of the payment invoice printed 50ms after mounting. That
 * is fine on a desktop with the logos already cached and wrong everywhere
 * else: on a phone, over the network, the browser took the print snapshot
 * while the four crests were still in flight and the sheet came out with four
 * empty gaps where the letterhead should be. Nothing on screen said anything
 * had gone wrong, because an `<img alt="">` that has not loaded simply
 * occupies its space quietly.
 *
 * Lives in its own module so the waiting can be tested on its own, against a
 * server that answers slowly — which is the only condition under which the
 * bug ever appeared.
 *
 * @param {string} selector   container whose images must be ready
 * @param {object} opts
 * @param {number} opts.timeout  how long to wait before printing anyway: a
 *                               slow or broken image delays the dialog, it
 *                               does not withhold it
 * @returns {{ cancel: () => void, done: Promise<string> }}
 *          `done` resolves with 'ready' or 'timeout', for tests and for
 *          callers that want to know which happened.
 */
export function printWhenReady(selector, { timeout = 3000, win = window, doc = document } = {}) {
  let cancelled = false

  const settled = () => {
    const imgs = [...doc.querySelectorAll(`${selector} img`)]
    if (!imgs.length) return Promise.resolve('ready')
    return Promise.all(imgs.map((img) => (
      // `complete` alone is not enough: it is true for an image that failed,
      // and naturalWidth is what separates "arrived" from "gave up".
      img.complete
        ? Promise.resolve()
        : new Promise((res) => {
            img.addEventListener('load', res, { once: true })
            img.addEventListener('error', res, { once: true })
          })
    ))).then(() => 'ready')
  }

  const done = Promise.race([
    settled(),
    new Promise((res) => setTimeout(() => res('timeout'), timeout)),
  ]).then((how) => {
    if (cancelled) return 'cancelled'
    // One frame later, so the images are laid out and not merely decoded
    // before the snapshot is taken.
    return new Promise((res) => {
      (win.requestAnimationFrame || ((f) => setTimeout(f, 16)))(() => {
        if (cancelled) return res('cancelled')
        win.print()
        res(how)
      })
    })
  })

  return { cancel: () => { cancelled = true }, done }
}
