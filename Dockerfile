# Front estático + proxy /api, empacotado como um serviço próprio —
# pensado pra rodar como App do EasyPanel (Caminho de Build: "/"),
# separado da API. Sem volumes: tudo o que precisa já vai dentro da imagem.
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY web /srv

EXPOSE 80
