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
    tipo_empresa TEXT CHECK (tipo_empresa IN ('comercio', 'servico', 'comercio e servico', 'industria')),
    regime_tributario TEXT CHECK (regime_tributario IN ('simples nacional', 'lucro real', 'lucro presumido', 'outro')),
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
  tipo_recebimento TEXT DEFAULT 'avulso' CHECK (tipo_recebimento IN ('mensal', 'avulso', 'parcelado')),
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
    tipo_pagamento TEXT DEFAULT 'avulso' CHECK (tipo_pagamento IN ('fixo', 'avulso', 'parcelado')),
    beneficiario TEXT,
    parcela_atual INTEGER DEFAULT 1,
    total_parcelas INTEGER DEFAULT 1,
    observacoes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pagamentos_fornecedor_id ON pagamentos(fornecedor_id);
CREATE INDEX idx_pagamentos_data_vencimento ON pagamentos(data_vencimento);
CREATE INDEX idx_pagamentos_status ON pagamentos(status);

CREATE TABLE movimentacoes_diarias (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida')),
    
    -- Relacionamentos opcionais com clientes/fornecedores
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    fornecedor_id UUID REFERENCES fornecedores(id) ON DELETE SET NULL,
    
    -- Campo para digitação manual (usado quando não há cliente/fornecedor selecionado)
    beneficiario_manual TEXT,
    
    categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL,
    forma_pagamento_id UUID REFERENCES formas_pagamento(id) ON DELETE SET NULL,
    descricao TEXT NOT NULL,
    valor DECIMAL(15,2) NOT NULL,
    data_transacao DATE DEFAULT CURRENT_DATE,
    responsavel TEXT, -- Quem autorizou/realizou a transação
    observacoes TEXT,
    comprovante_url TEXT, -- URL para imagem/comprovante
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_movimentacoes_diarias_tipo ON movimentacoes_diarias(tipo);
CREATE INDEX idx_movimentacoes_diarias_data ON movimentacoes_diarias(data_transacao);
CREATE INDEX idx_movimentacoes_diarias_categoria ON movimentacoes_diarias(categoria_id);
CREATE INDEX idx_movimentacoes_diarias_cliente ON movimentacoes_diarias(cliente_id);
CREATE INDEX idx_movimentacoes_diarias_fornecedor ON movimentacoes_diarias(fornecedor_id);

-- Adiciona a coluna para o Nome Fantasia
ALTER TABLE public.clientes
ADD COLUMN nome_fantasia text NULL;

-- Adiciona a coluna para a Inscrição Estadual (IE)
ALTER TABLE public.clientes
ADD COLUMN ie text NULL;

-- Adiciona a coluna para a Inscrição Municipal (IM)
ALTER TABLE public.clientes
ADD COLUMN im text NULL;

-- Adiciona a coluna para o Código CNAE (Classificação Nacional de Atividades Econômicas)
-- Sugiro TEXT, mas dependendo da sua validação, poderia ser INTEGER ou VARCHAR(9)
ALTER TABLE public.clientes
ADD COLUMN cnae text NULL;

-- Adiciona as colunas de Endereço

-- Logradouro (Rua, Avenida, etc.)
ALTER TABLE public.clientes
ADD COLUMN logradouro text NULL;

-- Número do Endereço
ALTER TABLE public.clientes
ADD COLUMN numero text NULL;

-- Complemento do Endereço (Sala, Apartamento, Bloco, etc.)
ALTER TABLE public.clientes
ADD COLUMN complemento text NULL;

-- Bairro
ALTER TABLE public.clientes
ADD COLUMN bairro text NULL;

-- CEP (Código de Endereçamento Postal)
ALTER TABLE public.clientes
ADD COLUMN cep text NULL;

-- Cidade/Município
ALTER TABLE public.clientes
ADD COLUMN cidade text NULL;

-- Estado/UF (Unidade Federativa)
-- É comum usar VARCHAR(2) para UF, mas TEXT também funciona.
ALTER TABLE public.clientes
ADD COLUMN uf text NULL;

-- Campo para indicar se é Matriz ou Filial (Opcional, mas útil)
-- Pode ser um BOOLEAN ou um TEXT/CHAR(1) com CHECK. Ex: 'M' ou 'F'.
ALTER TABLE public.clientes
ADD COLUMN tipo_unidade text NULL DEFAULT 'matriz'::text;

-- Adiciona uma restrição CHECK para o campo tipo_unidade (Matriz ou Filial)
ALTER TABLE public.clientes
ADD CONSTRAINT clientes_tipo_unidade_check CHECK (
  (
    tipo_unidade = any (
      array[
        'matriz'::text,
        'filial'::text
      ]
    )
  )
);

create table public.anexos_clientes (
  id uuid not null default extensions.uuid_generate_v4 (),
  id_cliente uuid not null,
  descricao text not null,
  url_anexo text not null,
  nome_arquivo text null,
  tipo_arquivo text null,
  data_anexo timestamp with time zone null default now(),
  created_at timestamp with time zone null default now(),
  created_by uuid null,
  categoria text null,
  ativo boolean null default true,
  constraint anexos_clientes_pkey primary key (id),
  constraint anexos_clientes_id_cliente_fkey foreign KEY (id_cliente) references clientes (id) on delete CASCADE,
  constraint anexos_clientes_categoria_check check (
    (
      (
        categoria = any (
          array[
            'contrato'::text,
            'proposta'::text,
            'banco_de_dados'::text,
            'certificado_digital'::text,
            'outro'::text
          ]
        )
      )
      or (categoria is null)
    )
  ),
  constraint anexos_clientes_url_check check ((url_anexo ~ '^https?://.*'::text))
) TABLESPACE pg_default;

create index IF not exists idx_anexos_clientes_id_cliente on public.anexos_clientes using btree (id_cliente) TABLESPACE pg_default;

create index IF not exists idx_anexos_clientes_data_anexo on public.anexos_clientes using btree (data_anexo) TABLESPACE pg_default;

create index IF not exists idx_anexos_clientes_categoria on public.anexos_clientes using btree (categoria) TABLESPACE pg_default;

create index IF not exists idx_anexos_clientes_ativo on public.anexos_clientes using btree (ativo) TABLESPACE pg_default;