const canvas = document.getElementById("matrixCanvas");
const ctx = canvas?.getContext("2d");

if (canvas && ctx) {
  const fontSize = 16;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+-/<>[]{}";
  let rainDrops = [];
  let lastFrame = 0;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const columns = Math.ceil(canvas.width / fontSize);
    rainDrops = Array.from({ length: columns }, () => Math.random() * canvas.height / fontSize);

    ctx.fillStyle = "#020202";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawMatrix() {
    ctx.fillStyle = "rgba(2, 2, 2, 0.11)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(4, 72, 121, 0.95)";
    ctx.font = `${fontSize}px monospace`;

    for (let i = 0; i < rainDrops.length; i++) {
      const text = alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      ctx.fillText(text, i * fontSize, rainDrops[i] * fontSize);

      if (rainDrops[i] * fontSize > canvas.height && Math.random() > 0.965) {
        rainDrops[i] = 0;
      }

      rainDrops[i]++;
    }
  }

  function animate(timestamp) {
    if (!lastFrame || timestamp - lastFrame >= 60) {
      drawMatrix();
      lastFrame = timestamp;
    }

    requestAnimationFrame(animate);
  }

  resizeCanvas();
  drawMatrix();
  requestAnimationFrame(animate);

  window.addEventListener("resize", resizeCanvas);
}
