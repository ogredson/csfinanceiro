CREATE TABLE usuarios (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nome TEXT,
    senha TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE clientes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT,
    telefone TEXT,
    documento TEXT,
    ativo BOOLEAN DEFAULT true,
		id_cliente bigint null,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE fornecedores (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT,
    telefone TEXT,
    documento TEXT,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE categorias (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
    cor TEXT DEFAULT '#6B7280',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserir categorias padrão para entradas
INSERT INTO categorias (nome, tipo, cor) VALUES 
('Aluguel de Software', 'entrada', '#10B981'),
('Treinamento', 'entrada', '#3B82F6'),
('Implantação', 'entrada', '#8B5CF6'),
('Desenvolvimento', 'entrada', '#F59E0B'),
('Suporte Técnico', 'entrada', '#EF4444'),
('Consultoria', 'entrada', '#EC4899');

-- Inserir categorias padrão para saídas
INSERT INTO categorias (nome, tipo, cor) VALUES 
('Comissões', 'saida', '#DC2626'),
('Aluguel Escritório', 'saida', '#7C3AED'),
('Energia/Internet', 'saida', '#059669'),
('Salários', 'saida', '#D97706'),
('Fornecedores', 'saida', '#475569'),
('Marketing', 'saida', '#DB2777'),
('Hardware', 'saida', '#0891B2'),
('Software', 'saida', '#65A30D');

CREATE TABLE formas_pagamento (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nome TEXT NOT NULL,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO formas_pagamento (nome) VALUES 
('PIX'),
('Boleto'),
('Cartão de Crédito'),
('Cartão de Débito'),
('Transferência Bancária'),
('Dinheiro');

CREATE TABLE recebimentos (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
    forma_pagamento_id UUID REFERENCES formas_pagamento(id) ON DELETE SET NULL,
    descricao TEXT NOT NULL,
    valor_esperado DECIMAL(15,2) NOT NULL,
    valor_recebido DECIMAL(15,2) DEFAULT 0,
    data_emissao DATE DEFAULT CURRENT_DATE,
    data_vencimento DATE NOT NULL,
    data_recebimento DATE,
    status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'recebido', 'cancelado')),
    tipo_recebimento TEXT DEFAULT 'avulso' CHECK (tipo_recebimento IN ('mensal', 'avulso', 'projeto')),
    parcela_atual INTEGER DEFAULT 1,
    total_parcelas INTEGER DEFAULT 1,
    observacoes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_recebimentos_clientes_id ON recebimentos(cliente_id);
CREATE INDEX idx_recebimentos_data_vencimento ON recebimentos(data_vencimento);
CREATE INDEX idx_recebimentos_status ON recebimentos(status);

CREATE TABLE pagamentos (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    fornecedor_id UUID REFERENCES fornecedores(id) ON DELETE SET NULL,
    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
    forma_pagamento_id UUID REFERENCES formas_pagamento(id) ON DELETE SET NULL,
    descricao TEXT NOT NULL,
    valor_esperado DECIMAL(15,2) NOT NULL,
    valor_pago DECIMAL(15,2) DEFAULT 0,
    data_emissao DATE DEFAULT CURRENT_DATE,
    data_vencimento DATE NOT NULL,
    data_pagamento DATE,
    status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
    tipo_pagamento TEXT DEFAULT 'variavel' CHECK (tipo_pagamento IN ('fixo', 'variavel', 'comissao')),
    beneficiario TEXT,
    parcela_atual INTEGER DEFAULT 1,
    total_parcelas INTEGER DEFAULT 1,
    observacoes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pagamentos_fornecedor_id ON pagamentos(fornecedor_id);
CREATE INDEX idx_pagamentos_data_vencimento ON pagamentos(data_vencimento);
CREATE INDEX idx_pagamentos_status ON pagamentos(status);

