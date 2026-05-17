window.addEventListener('DOMContentLoaded', async () => {
  console.log('[AIChat] global modular build loaded');

  if (typeof init === 'function') {
    try {
      await init();
      console.log('[AIChat] init success');
    } catch (e) {
      console.error('[AIChat] init failed', e);
    }
  } else {
    console.error('init() not found');
  }
});