export class Util {
  static hasClass(el: Element, className: string): boolean {
    if (el.classList) return el.classList.contains(className);
    return !!el.className.match(new RegExp('(\\s|^)' + className + '(\\s|$)'));
  }

  static addClass(el: Element, className: string): void {
    const classList = className.split(' ');
    if (el.classList) el.classList.add(classList[0]);
    else if (!this.hasClass(el, classList[0])) el.className += ' ' + classList[0];
    if (classList.length > 1) this.addClass(el, classList.slice(1).join(' '));
  }

  static removeClass(el: Element, className: string): void {
    const classList = className.split(' ');
    if (el.classList) el.classList.remove(classList[0]);
    else if (this.hasClass(el, classList[0])) {
      const reg = new RegExp('(\\s|^)' + classList[0] + '(\\s|$)');
      el.className = el.className.replace(reg, ' ');
    }
    if (classList.length > 1) this.removeClass(el, classList.slice(1).join(' '));
  }

  static osHasReducedMotion(): boolean {
    if (!window.matchMedia) return false;
    const matchMediaObj = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (matchMediaObj) return matchMediaObj.matches;
    return false;
  }
}
