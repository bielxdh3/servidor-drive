
console.log("Carregado")
// 1. Configurações iniciais
const canvas = document.getElementById('matrixCanvas');
const ctx = canvas.getContext('2d');

// Ajusta o tamanho do canvas para o tamanho da janela
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// 2. Os caracteres "Hacker"
// Você pode usar Katakana (japonês), números e letras
const katakana = "アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン";
const latin = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const nums = "0123456789";
const alphabet = katakana + latin + nums;

// 3. Configurações da chuva
const fontSize = 16;
// Calcula quantas colunas cabem na largura da tela
const columns = canvas.width / fontSize;

// Array para guardar a posição 'y' atual de cada coluna
// Inicializamos cada coluna no topo (y = 1)
const rainDrops = [];
for (let x = 0; x < columns; x++) {
  rainDrops[x] = 1;
}

// 4. A função de desenho (roda a cada frame)
const draw = () => {
  // Fundo preto com opacidade (é isso que cria o efeito de "rastro" ou "fade")
  // A cada frame, desenhamos um retângulo preto quase transparente por cima
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Cor e fonte dos caracteres
  ctx.fillStyle = 'rgba(4, 72, 121, 0.3)'; // Verde Matrix Clássico
  ctx.font = fontSize + 'px monospace';

  // Loop por todas as colunas
  for (let i = 0; i < rainDrops.length; i++) {
    // Pega um caractere aleatório do alfabeto
    // Procure essa linha dentro da função draw e deixe assim:
    const text = alphabet.charAt(Math.floor(Math.random() * alphabet.length));

    // Desenha o caractere na posição (x, y) atual
    // x = i * fontSize (cada coluna no seu lugar)
    // y = rainDrops[i] * fontSize (a posição vertical que desce)
    ctx.fillText(text, i * fontSize, rainDrops[i] * fontSize);

    // Se a gota passar do final da tela OU aleatoriamente
    // nós a resetamos para o topo da tela
    if (rainDrops[i] * fontSize > canvas.height && Math.random() > 0.975) {
      rainDrops[i] = 0;
    }

    // Move a gota um caractere para baixo para o próximo frame
    rainDrops[i]++;
  }
};

// 5. O Loop de animação
// Executa a função draw a cada 30 milissegundos
setInterval(draw, 30);

// 6. Tratamento de redimensionamento de janela
// Se o usuário esticar a tela, precisamos recalcular tudo
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Recalcula colunas e reseta gotas
  const newColumns = canvas.width / fontSize;
  rainDrops.length = 0; // Limpa o array
  for (let x = 0; x < newColumns; x++) {
    rainDrops[x] = 1;
  }
});