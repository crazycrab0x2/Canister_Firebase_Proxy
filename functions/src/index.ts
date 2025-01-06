import * as express from "express";
import * as cors from "cors";
import * as functions from "firebase-functions";

import * as admin from "firebase-admin";

admin.initializeApp();

const app = express();
app.use(express.json());
app.use(cors({ origin: true }));

const runtimeOpts = {
  timeoutSeconds: 300,
  maxInstances: 1,
};

const processingCache = new Map(); // Shared in-memory cache
const requestCache = new Map(); // Shared in-memory cache
const openaiKey: string = functions.config().openai.key;
// console.log("openAI-KEY", openaiKey)

const apiUrl = "https://api.openai.com";

interface ImageGenerationResponse {
  created: number;
  data: [
    {
      url: string;
      revised_prompt: string;
    }
  ];
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint: string;
  choices: [
    {
      index: number;
      message: {
        role: string;
        content: string;
      };
      logprobs: object;
      finish_reason: string;
    }
  ];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details: {
      reasoning_tokens: number;
      accepted_prediction_tokens: number;
      rejected_prediction_tokens: number;
    };
  };
}

//chat generation
const fetchOpenAI = async ({
  req,
  res,
  api,
}: {
  req: express.Request;
  res: express.Response;
  api: string;
}) => {
  try {
    let response = await callOpenAI({ req, api });
    // response = response.replace(/\n/g, "<br/>");
    console.log("response", response);
    res.set("Cache-Control", "no-cache");
    res.status(200).send(response);
  } catch (err: Error | unknown) {
    res.status(500).send(err);
    console.log("error - ", err)
  }
};

//call OpenAI for chat completions
const callOpenAI = async ({
  req,
  api,
}: {
  req: express.Request;
  api: string;
}): Promise<string> => {
  const key = req.body.key;
  const request = req.body.request

  if (key) {
    if (requestCache.has(request)) {
      const oldDate = requestCache.get(request);

      if (oldDate == key) {
        const ongoingPromise = processingCache.get(request);
        const result = await ongoingPromise;
        return result;
      } else {
        const processingPromise = processRequest(req, api);
        requestCache.set(request, key);
        processingCache.set(request, processingPromise);

        const result: any = await processingPromise;

        return result;
      }
    }

    const processingPromise = processRequest(req, api);
    requestCache.set(request, key);
    processingCache.set(request, processingPromise);

    const result: any = await processingPromise;

    return result;
  } else {
    return "error";
  }
};

async function processRequest(req: express.Request, api: string) {
  const request = req.body.request as string;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${openaiKey}`,
  };

  if (api == "completions") {
    const response = await fetch(`${apiUrl}/v1/chat/${api}`, {
      method: "POST",
      headers,
      body: request,
    });

    if (!response.ok) {
      throw new Error(
        `Response not ok. Status ${response.status}. Message ${response.statusText}.`
      );
    }
    const result: ChatCompletionResponse = await response.json();
    return result.choices[0].message.content;
  } else {
    const response = await fetch(`${apiUrl}/v1/images/${api}`, {
      method: "POST",
      headers,
      body: request,
    });

    if (!response.ok) {
      throw new Error(
        `Response not ok. Status ${response.status}. Message ${response.statusText}.`
      );
    }
    const result: ImageGenerationResponse = await response.json();
    return result.data[0].url;
  }
}

app.post("/chat", async (req: any, res: any) => {
  await fetchOpenAI({ req, res, api: "completions" });
});

app.post("/image", async (req: any, res: any) => {
  await fetchOpenAI({ req, res, api: "generations" });
});

exports.chatgpt = functions.runWith(runtimeOpts).https.onRequest(app);
