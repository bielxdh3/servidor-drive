const canvas = document.getElementById("matrixCanvas");
const ctx = canvas?.getContext("2d");

if (canvas && ctx) {
  const fontSize = 16;
  const chars = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ0123456789";
  let rainDrops = [];
  let lastFrame = 0;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const columns = Math.ceil(canvas.width / fontSize);

    rainDrops = Array.from({ length: columns }, () => ({
      y: Math.random() * canvas.height / fontSize,
      speed: Math.random() * 0.5 + 0.3,
      char: ""
    }));

    ctx.fillStyle = "#020202";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawMatrix() {

    ctx.fillStyle = "rgba(2, 2, 2, 0.05)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = `${fontSize}px monospace`;

    for (let i = 0; i < rainDrops.length; i++) {
      const drop = rainDrops[i];
      

      const text = chars.charAt(Math.floor(Math.random() * chars.length));


      if (Math.random() > 0.9) {
          ctx.fillStyle = "#7bc8ff"; 
          ctx.shadowBlur = 10;
          ctx.shadowColor = "#4facfe";
      } else {
          ctx.fillStyle = "rgba(4, 72, 121, 0.9)"; 
          ctx.shadowBlur = 0;
      }

      ctx.fillText(text, i * fontSize, drop.y * fontSize);

      drop.y += drop.speed;

      if (drop.y * fontSize > canvas.height && Math.random() > 0.98) {
        drop.y = 0;
      }
    }

    drawScanlines();
  }

  function drawScanlines() {
    ctx.shadowBlur = 0; 
    ctx.fillStyle = "rgba(5, 5, 5, 0.1)";
    for (let i = 0; i < canvas.height; i += 4) {
      ctx.fillRect(0, i, canvas.width, 1);
    }
  }

  function animate(timestamp) {
    // Mantive os 80ms para a velocidade que você gostou, 
    // mas o movimento agora é mais fluido pelo uso de decimais no drop.y
    if (!lastFrame || timestamp - lastFrame >= 80) {
      drawMatrix();
      lastFrame = timestamp;
    }
    requestAnimationFrame(animate);
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  requestAnimationFrame(animate);
}