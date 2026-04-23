const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

// configurar onde salvar arquivos
const storage = multer.diskStorage({
  destination: "./temp",
filename: (req, file, cb) => {
  cb(null, file.originalname);
}
});

const upload = multer({ storage });

// permitir acessar arquivos
app.use(express.static("public"));
app.use("/files", express.static("uploads"));

// rota de upload
app.post("/upload", upload.single("file"), (req, res) => {
  res.send("Upload feito!");
});

// rota pra listar arquivos
app.get("/list", (req, res) => {
  fs.readdir("./uploads", (err, files) => {
    res.json(files);
  });
});

// iniciar servidor
// aprovar arquivo
app.get("/approve/:name", (req, res) => {
  const oldPath = "./temp/" + req.params.name;
  const newPath = "./uploads/" + req.params.name;

  fs.rename(oldPath, newPath, (err) => {
    if (err) return res.send("Erro ao aprovar");
    res.send("Aprovado!");
  });
});

// listar pendentes
app.get("/pending", (req, res) => {
  fs.readdir("./temp", (err, files) => {
    res.json(files);
  });
});
// rejeitar arquivo (deleta da temp)
app.get("/reject/:name", (req, res) => {
  const filePath = "./temp/" + req.params.name;

  fs.unlink(filePath, (err) => {
    if (err) return res.send("Erro ao rejeitar");
    res.send("Rejeitado!");
  });
});

// excluir arquivo (deleta da uploads)
app.get("/delete/:name", (req, res) => {
  const filePath = "./uploads/" + req.params.name;

  fs.unlink(filePath, (err) => {
    if (err) return res.send("Erro ao excluir");
    res.send("Excluído!");
  });
});
app.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});