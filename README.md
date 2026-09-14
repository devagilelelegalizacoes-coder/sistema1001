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
- n8n: `http://n8n.localhost` (Windows não resolve `*.localhost` sozinho —
  ou adiciona `127.0.0.1 n8n.localhost` no hosts, ou testa com
  `curl -H "Host: n8n.localhost" http://localhost/`)

A API aplica as migrações sozinha ao subir. O front usa o proxy `/api`, então
não é necessário expor a porta interna da API.

O Caddy aqui **não emite certificado sozinho** — ele espera um proxy na
frente (EasyPanel/Traefik, Cloudflare, etc.) cuidando do HTTPS público e
repassando HTTP puro pra dentro. Ver `Subir num VPS sem outro proxy na
frente` mais abaixo se for o seu caso.

Para produção, crie `.env` a partir de `.env.example`, defina senhas fortes e
os domínios reais antes de executar o Compose.

## Implantar no EasyPanel

### Pelo Compose (recomendado — um deploy só)

Se o seu EasyPanel tem o card **"Compose"** ao adicionar um serviço (junto
com App/Postgres/Redis), é o caminho mais simples: ele sobe a stack inteira
(`docker-compose.yml` deste repositório) de uma vez, com todos os serviços
já se enxergando pelo nome, igual roda local.

1. **+ Adicionar serviço → Compose**, fonte Github, mesmo repositório,
   ramo `master`.
2. Na aba de **variáveis de ambiente do serviço Compose** (não é a de cada
   container — é uma só, no nível do projeto Compose), defina o que o
   `docker-compose.yml` espera via `${...}`:

   ```
   DB_SENHA=escolha-uma-senha-forte
   JWT_SECRET=9c880aeceab34b727530b18b98ccf7a6f5c0378c00184190b41310d641820388
   N8N_USUARIO=admin
   N8N_SENHA=escolha-outra-senha-forte
   DOMINIO=SEU-DOMINIO-OU-SUBDOMINIO-AQUI
   N8N_HOST=SEU-N8N-DOMINIO-OU-SUBDOMINIO-AQUI
   ```

   **`DOMINIO` e `N8N_HOST` têm que ser exatamente o hostname público** que
   vai apontar pra cá (ex.: `sistema1001.seudominio.com`, ou o
   `algumacoisa.easypanel.host` que o EasyPanel gerar) — é contra esse
   valor que o Caddy decide se responde a requisição. Errar isso é a causa
   mais comum de página em branco: o Caddy recebe a requisição, mas o Host
   não bate com o que ele espera e ele não sabe o que responder.

   `JWT_SECRET` acima é só um exemplo gerado agora — pode usar, mas o ideal
   é gerar o seu: `openssl rand -hex 32`.

3. Depois do deploy, na aba **Domínios**: aponte seu domínio principal pro
   serviço/container `caddy`, porta `80`. Se for usar n8n com domínio
   próprio, pode apontar outro domínio direto pro container `n8n`, porta
   `5678` (mais simples que passar pelo Caddy) — ou usar o `N8N_HOST`
   configurado acima e apontar pro `caddy` também, porta `80`.

### Como serviços individuais (App por Dockerfile)

Se não tiver Compose disponível, dá pra recriar a stack como serviços
separados dentro de um mesmo projeto (pra caírem na mesma rede interna e
se enxergarem pelo nome):

| Serviço | Como criar | Configuração |
|---|---|---|
| `db` | Template PostgreSQL do próprio EasyPanel | Anota usuário/senha/porta que ele gerar |
| `redis` | Template Redis do próprio EasyPanel | — |
| `api` | App → Github → Caminho de Build `/api` | Env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (ver `.env.example`). Aplica migração sozinho ao subir. |
| `worker` | App → Github → Caminho de Build `/api` (mesmo repo) | Mesmas envs da `api`, **e sobrescreve o "Start Command"** para `celery -A app.tarefas worker -l info --concurrency=2` |
| `n8n` | Template n8n do próprio EasyPanel (ou App com a imagem `n8nio/n8n`) | — |
| `web` | App → Github → Caminho de Build `/` (raiz) | **`DOMINIO`** = o hostname público exato deste serviço (ex.: o `algumacoisa.easypanel.host` que o EasyPanel gerou, ou seu domínio próprio). Sem isso o Caddy fica esperando `localhost` e a página fica em branco. |

**Nomeie os serviços exatamente `api` e `n8n`** (ou ajuste o `Caddyfile`):
ele faz `reverse_proxy api:8000` e `reverse_proxy n8n:5678` usando esses
nomes como hostname interno.

Na aba **Domínios** do serviço `web`, aponte seu domínio (e o domínio do
n8n, se quiser expô-lo) pra ele, porta `80` — é o EasyPanel que emite o
certificado e fala HTTPS com quem acessa de fora; o Caddy por dentro só
fala HTTP puro (por isso o `Dockerfile`/`Caddyfile` da raiz).

Se o repositório for privado, dá pra conectar via *Deploy Key* (chave SSH
somente leitura, gerada pelo próprio EasyPanel ao trocar a fonte pra "Git")
em vez de deixar o repositório público.

## Subir num VPS sem outro proxy na frente

Se for expor direto (sem EasyPanel/Traefik/Cloudflare por cima) e deixar o
Caddy cuidar do HTTPS sozinho:

1. `Caddyfile`: troque `http://{$DOMINIO:localhost}` e
   `http://{$N8N_HOST:n8n.localhost}` por `{$DOMINIO}` e `{$N8N_HOST}`
   (sem o `http://` na frente).
2. `docker-compose.yml`: no serviço `caddy`, troque `ports: ["80:80"]` por
   `ports: ["80:80", "443:443"]`.

```bash
cp .env.example .env      # preencha DB_SENHA, JWT_SECRET, N8N_SENHA, DOMINIO, N8N_HOST
docker compose up -d --build
```

Depois:

- Front: `https://SEU_DOMINIO`
- API + documentação interativa: `https://SEU_DOMINIO/api/docs`
- n8n: `https://SEU_N8N_HOST`

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
Dockerfile            ← empacota o Caddy + o front (serviço "web" separado,
                        pensado pro EasyPanel — ver "Implantar no EasyPanel")
api/Dockerfile        ← empacota a API/worker (mesma imagem, comandos diferentes)
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
