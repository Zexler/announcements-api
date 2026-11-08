import "dotenv/config";
import app from "./src/app.ts";

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
