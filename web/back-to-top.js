const contents = document.querySelector('.page-toc');
const backToTop = document.querySelector('.back-to-top');

function updateBackToTop() {
  backToTop.hidden = contents.getBoundingClientRect().bottom > 0;
}

window.addEventListener('scroll', updateBackToTop, { passive: true });
window.addEventListener('resize', updateBackToTop);
window.addEventListener('pageshow', updateBackToTop);
updateBackToTop();
