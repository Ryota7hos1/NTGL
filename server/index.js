const { open } = require('./db');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 8765;
const app = createApp({ db: open(process.env.DB_FILE) });

app.listen(port, () => console.log(`NTGL demo running at http://localhost:${port}`));
