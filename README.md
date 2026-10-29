<p align="center"><img src="assets/banner.png" alt="Direct Hub" width="720"></p>

# Direct Hub

Hub de comunicação local-first: um invólucro local para várias sessões oficiais do WhatsApp Web e do Instagram Direct, com isolamento persistente por conta.

## Executar

Requer Node.js 20+.


1. Instale as dependências com `npm install`.
2. Inicie a aplicação com `npm start`.
3. Use **Adicionar conta**, escolha o serviço e leia o QR Code do WhatsApp Web ou entre com usuário e senha do Instagram.

Cada conta recebe uma partição Electron própria (`persist:<serviço>-<UUID>`). Contas guardadas antes do Instagram continuam como WhatsApp. Cookies, IndexedDB, cache e service workers ficam separados e são restaurados quando a aplicação reabre. Remover uma conta também apaga os dados locais da respetiva partição.

## Mac com chip M (Apple Silicon)

Roda nativo em arm64 (M1, M2, M3, M4); o código não tem módulos nativos, só o Electron.

- Do código-fonte: `npm install && npm start`.
- Instalador: `npm run dist:mac` gera `dist/Direct Hub-<versão>-arm64.dmg`. O app sai com assinatura ad-hoc, sem certificado Apple. Se o macOS disser que o app está danificado ao abrir um `.dmg` baixado, rode `xattr -cr "/Applications/Direct Hub.app"`.

## Segurança aplicada

- Cada conteúdo remoto usa `WebContentsView`; não há tag `<webview>` nem APIs WhatsApp não oficiais.
- Conteúdo do WhatsApp executa com `nodeIntegration: false`, `contextIsolation: true` e sandbox ativo.
- Apenas as vistas do WhatsApp usam uma identificação compatível com o Chrome atual, pois o serviço rejeita o token de produto Electron apesar do Chromium atualizado.
- A interface local só recebe uma API IPC estreita através do preload.
- O processo principal valida que chamadas de gestão de contas vieram da interface local.
- Permissões remotas são recusadas, exceto câmera e microfone quando solicitados por `web.whatsapp.com`; a navegação continua limitada a esse domínio.

## Estado desta entrega

A fundação de isolamento, persistência das contas, alternância de sessões e a primeira ponte de contadores não lidos estão prontas. O contador de não lidas do Instagram usa o seletor da receita de Instagram do [Ferdium](https://github.com/ferdium/ferdium-recipes/tree/main/recipes/instagram) (MIT). O cliente IMAP/SMTP, SQLite e a camada de IA local pertencem às fases seguintes do roteiro.

## Licença

Código-fonte aberto para leitura e uso, sob a [PolyForm Strict License 1.0.0](LICENSE). Em resumo:

- **Pode:** baixar, rodar e usar para fins não comerciais (uso pessoal, estudo, pesquisa, organizações sem fins lucrativos).
- **Não pode:** modificar, criar obras derivadas, redistribuir ou usar comercialmente sem autorização.

Não é "open source" no sentido da OSI; é *source-available*. Para outro tipo de licença, abra uma issue.

O seletor de não lidas do Instagram vem das receitas do [Ferdium](https://github.com/ferdium/ferdium-recipes) (MIT). WhatsApp e Instagram são marcas da Meta; este projeto não tem relação com ela.
