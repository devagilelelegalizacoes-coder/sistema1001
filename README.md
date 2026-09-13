# Sistema 1001

Controle de processos da AUTO VIAÇÃO 1001 — Agile Legalizações.
Substitui o protótipo (Portal 1001 + planilha) por um sistema próprio.

## Subir para testar

O Compose já inclui PostgreSQL, Redis, API, worker, n8n e o servidor web. Para
subir localmente com os valores de desenvolvimento padrão:

```bash
docker compose up -d --build
```

No Windows PowerShell, o comando é o mesmo. Depois, abra:

- Front: `http://localhost`
- API + documentação interativa: `http://localhost/api/docs`
- n8n: `http://n8n.localhost`

A API aplica as migrações sozinha ao subir. O front usa o proxy `/api`, então
não é necessário expor a porta interna da API.

Para produção, crie `.env` a partir de `.env.example`, defina senhas fortes e
os domínios reais antes de executar o Compose.

## Subir em produção

```bash
cp .env.example .env      # preencha DB_SENHA, JWT_SECRET, N8N_SENHA
docker compose up -d --build
```

Depois:

- Front: `https://SEU_DOMINIO`
- API + documentação interativa: `https://SEU_DOMINIO/api/docs`
- n8n: `https://SEU_N8N_HOST`

Para rodar local sem domínio, deixe `DOMINIO=localhost` no `.env`.

## Carga inicial

Leva os 56 processos do protótipo para o banco novo:

```bash
docker compose exec api python -m app.seed.importar_portal /caminho/export
```

O `export` é a pasta com `tickets/*.json` e `avisos/*.json` exportados do portal.
A carga cria as empresas (1001, JCA, Metar), a equipe e os lotes.

**Senha inicial de todos os usuários: `trocar123`. Troque no primeiro acesso.**

## Desenvolvimento

```bash
pip install -r api/requirements.txt
python -m pytest tests/ -q          # regras de negócio, sem banco
cd api && uvicorn app.main:app --reload
```

## Estrutura

```
api/app/regras.py     ← regras de negócio puras. É aqui que mora o que importa,
                        e é o que os testes cobrem. Sem banco, sem HTTP.
api/app/models.py     ← tabelas
api/app/routers/      ← endpoints
api/app/seed/         ← carga do protótipo
web/                  ← front em HTML/JS, sem framework
tests/                ← testes das regras
```

## Decisões que valem conhecer antes de mexer

**`processo.data_limite` é coluna gerada pelo banco** (`data_recebimento + prazo_dias`).
Não existe caminho para digitar um valor divergente.

**`nota_item.processo_id` é UNIQUE.** É o que impede faturar o mesmo veículo em
duas notas — a garantia é do banco, não da tela. A API devolve 409 nesse caso.

**O status não é coluna.** Ele depende de `hoje`, então muda sozinho com a passagem
do tempo e não pode ser materializado. É calculado em `regras.calcular_status()`,
o mesmo código que a API e os testes usam.

**Veículo pode não ter placa.** Acontece de verdade: o pedido chega com o número de
ordem e a placa está dentro do PDF anexo. O índice único da placa é parcial
(`WHERE placa IS NOT NULL`). Nunca inventar placa — é dado de processo no DETRAN.

**Valor da nota já inclui a despesa.** A diferença é o que fica para o escritório.
Despesa sugerida: R$ 190,00 com vistoria, R$ 50,00 nos demais — sempre editável.

**Regra de negócio fica na API, não no n8n.** n8n cuida do que conversa com o mundo
externo: e-mail, Drive, alertas por horário.

## Papéis

| Papel | Pode |
|---|---|
| `admin` | tudo, incluindo faturamento |
| `operador` | processos e avisos; não vê valores |
| `despachante` | igual ao operador |
| `cliente` | só os processos da própria empresa, sem valores |

O papel `cliente` é o que permite dar acesso ao responsável da 1001 — algo que o
protótipo não conseguia fazer.
