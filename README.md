# Exam Hall Allocation Tool

The application source is in [`examhall/`](./examhall/).

## Run locally

```powershell
cd examhall
npm install
npm start
```

Open http://localhost:3000. The app runs with in-memory storage by default. To persist data with MongoDB Atlas, copy `.env.example` to `.env` and set `MONGODB_URI`.

See [`examhall/README.md`](./examhall/README.md) for allocation rules and input details.