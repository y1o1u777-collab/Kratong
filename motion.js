/* Krathong Live · entrance choreography
 * GSAP drives the hero reveal and a gentle scroll parallax; a small
 * IntersectionObserver adds the section reveals so they still work if a
 * plugin ever fails to load.
 */
(() => {
  'use strict';

  const gsap = window.gsap;
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let scrollTriggers = [];

  function reduced() {
    return reduceQuery.matches || document.body.classList.contains('reduce-motion');
  }

  function heroIntro() {
    if (!gsap || reduced()) return;
    const hero = document.querySelector('.hero-stage');
    if (!hero) return;
    const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
    timeline.from('.hero-stage .eyebrow', { y: 18, opacity: 0, duration: 0.9 }, 0.35);
    timeline.from('#hero-title', { y: 44, opacity: 0, duration: 1.2 }, 0.45);
    timeline.from('.hero-content > p', { y: 26, opacity: 0, duration: 0.95 }, 0.78);
    timeline.from('.hero-actions > *', { y: 18, opacity: 0, duration: 0.85, stagger: 0.12 }, 0.98);
    timeline.from('.hero-legend', { opacity: 0, duration: 0.9 }, 1.2);
    timeline.from('.hero-scroll-cue', { opacity: 0, y: -10, duration: 0.9 }, 1.3);
  }

  function revealSections() {
    const items = [...document.querySelectorAll('.reveal')];
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) {
      items.forEach(item => item.classList.add('is-in'));
      return;
    }
    document.documentElement.classList.add('motion-ready');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach(item => observer.observe(item));
  }

  function scrollParallax() {
    if (!gsap || !window.ScrollTrigger || reduced()) return;
    gsap.registerPlugin(window.ScrollTrigger);
    if (document.querySelector('.hero-fallback')) {
      scrollTriggers.push(gsap.to('.hero-fallback', {
        yPercent: 8,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero-stage',
          start: 'top top',
          end: 'bottom top',
          scrub: true
        }
      }));
    }
    const river = document.querySelector('.gallery-river');
    if (river) {
      scrollTriggers.push(gsap.fromTo(river, { y: 30 }, {
        y: -30,
        ease: 'none',
        scrollTrigger: {
          trigger: river,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true
        }
      }));
    }
  }

  function motionToggle() {
    if (!gsap) return;
    document.querySelectorAll('.primary-button, .outline-button').forEach(button => {
      const enter = () => {
        if (reduced()) return;
        gsap.to(button, { y: -2, duration: 0.25, ease: 'power2.out', overwrite: 'auto' });
      };
      const leave = () => {
        gsap.to(button, { y: 0, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
      };
      button.addEventListener('pointerenter', enter);
      button.addEventListener('pointerleave', leave);
    });
  }

  function boot() {
    heroIntro();
    revealSections();
    scrollParallax();
    motionToggle();
    document.addEventListener('krathong:motion', () => {
      if (reduced()) {
        scrollTriggers.forEach(trigger => trigger.scrollTrigger?.kill());
        scrollTriggers = [];
      } else if (!scrollTriggers.length) {
        scrollParallax();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
