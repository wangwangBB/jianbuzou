(() => {
  document.querySelectorAll('[data-copy-share]').forEach(button => {
    button.addEventListener('click', async () => {
      const input = document.getElementById(button.dataset.copyShare);
      try {
        await navigator.clipboard.writeText(input.value);
        button.textContent = '已复制，请发送给对应工作人员';
      } catch {
        input.focus(); input.select(); input.setSelectionRange(0, input.value.length);
        button.textContent = '请长按或复制已选中的链接';
      }
    });
  });
})();
