import express, { Request, Response } from "express";
import mysql from "mysql2/promise";
import session from 'express-session';
import bcrypt from 'bcrypt';
import path from "path";

const app = express();

// Configuração do EJS como motor de visualização
app.set('view engine', 'ejs');
app.set('views', `${__dirname}/views`);
app.use(express.static(path.join(__dirname, 'public')));

// Conexão com o banco de dados
const connection = mysql.createPool({
    host: "db", // Ajuste o host conforme necessário
    port: 3306,
    user: "root",
    password: "mudar123",
    database: "unicesumar"
});

// Middleware para parsing de JSON e urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração de sessão
app.use(session({
    secret: '$#$123',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Middleware de autenticação
function isAuthenticated(req: Request, res: Response, next: () => void) {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
}

// Função para criar usuário padrão e tabela
async function createDefaultUser() {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            senha VARCHAR(255) NOT NULL,
            papel VARCHAR(50) NOT NULL,
            ativo TINYINT DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
    `;

    const defaultEmail = "admin@admin.com";
    const defaultPassword = "1234"; // Senha ajustada para "1234"
    const defaultUserName = "Administrador";

    try {
        // Criação da tabela se não existir
        await connection.query(createTableQuery);
        console.log("Tabela 'users' verificada/criada com sucesso.");

        // Verificação de existência do usuário padrão
        const [rows] = await connection.query('SELECT * FROM users WHERE email = ?', [defaultEmail]);
        if ((rows as any[]).length === 0) {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);
            await connection.query('INSERT INTO users (nome, email, senha, papel, ativo) VALUES (?, ?, ?, ?, ?)', 
                [defaultUserName, defaultEmail, hashedPassword, 'admin', 1]);
            console.log(`Usuário padrão criado: Email - ${defaultEmail}, Senha - ${defaultPassword}`);
        } else {
            console.log('Usuário padrão já existe.');
        }
    } catch (error) {
        console.error('Erro ao verificar/criar a tabela e o usuário padrão:', error);
    }
}

// Função para aguardar a disponibilidade do banco de dados
async function waitForDatabaseConnection() {
    let isConnected = false;
    while (!isConnected) {
        try {
            await connection.query('SELECT 1');
            isConnected = true;
            console.log('Conectado ao banco de dados com sucesso.');
        } catch (error) {
            console.log('Tentando se conectar ao banco de dados...');
            await new Promise(res => setTimeout(res, 2000)); // Aguarde 2 segundos antes de tentar novamente
        }
    }
}

// Chamada da função de criação de tabela/usuário após garantir que o banco está pronto
waitForDatabaseConnection().then(async () => {
    await createDefaultUser();
    console.log("Usuário padrão verificado/criado.");

    // Rotas da aplicação
    app.get('/', (req: Request, res: Response) => {
        if (req.session.userId) {
            return res.render('index', { userName: req.session.userName });
        } else {
            return res.redirect('/login');
        }
    });

    app.get('/login', (req: Request, res: Response) => {
        return res.render('users/login'); 
    });

    app.post('/login', async (req: Request, res: Response) => {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).send('Email e senha são obrigatórios.');
        }

        try {
            const [rows] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
            if ((rows as any[]).length === 0) {
                return res.status(401).send('Email ou senha inválidos.');
            }

            const user = (rows as any[])[0];
            const senhaCorreta = await bcrypt.compare(senha, user.senha);

            if (!senhaCorreta) {
                return res.status(401).send('Email ou senha inválidos.');
            }

            req.session.userId = user.id;
            req.session.userName = user.nome;

            res.redirect('/');
        } catch (error) {
            console.log('Erro ao realizar login:', error);
            res.status(500).send('Erro ao realizar login');
        }
    });

    app.get('/users', isAuthenticated, async (req: Request, res: Response) => {
        try {
            const [rows] = await connection.query("SELECT * FROM users");
            return res.render('users/index', {
                users: rows 
            });
        } catch (err) {
            console.error(err);
            res.status(500).send("Erro ao buscar usuários");
        }
    });

    app.get('/users/add', isAuthenticated, async (req: Request, res: Response) => {
        return res.render('users/add'); 
    });

    app.post('/users', isAuthenticated, async (req: Request, res: Response) => {
        const { nome, email, senha, confirmSenha, papel, ativo } = req.body;

        if (!nome || !email || !senha || !papel) {
            return res.status(400).send('Todos os campos são obrigatórios.');
        }

        if (senha !== confirmSenha) {
            return res.status(400).send('As senhas não coincidem.');
        }

        const ativoValue = ativo ? 1 : 0;
        const saltRounds = 10;

        try {
            const hashedPassword = await bcrypt.hash(senha, saltRounds);
            await connection.query('INSERT INTO users (nome, email, senha, papel, ativo) VALUES (?, ?, ?, ?, ?)', 
                [nome, email, hashedPassword, papel, ativoValue]);

            res.redirect('/users'); 
        } catch (error) {
            console.error('Erro ao cadastrar usuário:', error);
            res.status(500).send('Erro ao cadastrar usuário.');
        }
    });

    app.delete('/users/:id/delete', isAuthenticated, async (req: Request, res: Response) => {
        const { id } = req.params;

        try {
            await connection.query('DELETE FROM users WHERE id = ?', [id]);
            res.json({ message: 'Usuário deletado com sucesso' });
        } catch (error) {
            console.log('Erro ao deletar o usuário:', error);
            res.status(500).send('Erro ao deletar usuário');
        }
    });

    app.get('/users/:id/edit', isAuthenticated, async (req: Request, res: Response) => {
        const { id } = req.params;

        try {
            const [rows] = await connection.execute('SELECT * FROM users WHERE id = ?', [id]);
            
            if ((rows as any[]).length === 0) {
                return res.status(404).send('Usuário não encontrado.');
            }

            return res.render('users/edit', {
                user: rows[0]
            });
        } catch (error) {
            console.error('Erro ao buscar usuário para edição:', error);
            res.status(500).send('Erro ao buscar usuário.');
        }
    });

    app.post('/users/:id/edit', isAuthenticated, async (req: Request, res: Response) => {
        const { id } = req.params;
        const { nome, email, senha, papel, ativo } = req.body;

        const ativoValue = ativo ? 1 : 0;

        try {
            await connection.execute(
                'UPDATE users SET nome = ?, email = ?, senha = ?, papel = ?, ativo = ? WHERE id = ?', 
                [nome, email, senha, papel, ativoValue, id]
            );

            res.redirect('/users'); 
        } catch (error) {
            console.error('Erro ao atualizar usuário:', error);
            res.status(500).send('Erro ao atualizar usuário.');
        }
    });

    // Inicialização do servidor
    const port = 3000;
    app.listen(port, () => {
        console.log(`Servidor rodando em http://localhost:${port}`);
    });
}).catch(error => {
    console.error('Erro ao inicializar o servidor:', error);
});
