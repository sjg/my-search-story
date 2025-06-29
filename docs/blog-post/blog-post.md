# Using Your Search History to Create an AI Story 🚀

Have you ever wondered what kind of story your digital footprint could tell? This "My Search Story" project explores this very idea by transforming your Google search history into a unique, AI-generated short story, complete with audio narration and a custom background image all provided by Google's excellent Generative AI Tooling.

This blog post will take you on a technical tour of how the web application works, focusing on four key aspects:

1.  **Unlocking Your Data** with the Data Portability API.
2.  **Weaving a Narrative** with the Gemini 2.5 Flash model in Vertex AI.
3.  **Visualising the Story** using Imagen and a custom prompt based on the Story. 
4.  **Giving Your Story a Voice** with the Cloud Text-to-Speech API.

Let's dive in! 💻

---

## 1. Unlocking Your Data with the Data Portability API 🗝️

The foundation of this project is the user's own data. The [Google Data Portability API](https://developers.google.com/data-portability) is a powerful tool that empowers users (currently only in the EEA) giving them control over their data. It allows them to request an archive of their data from various Google products, which they can then move to another service or, in our case, use for creative projects.

Our application uses this API to fetch a user's search history over a specified date range. The process involves a few key steps, all handled on a custom Node.js backend.

### Initiating the Data Archive

First, we need to make a `POST` request to the `portabilityArchive:initiate` endpoint. This request includes the user's OAuth 2.0 access token and specifies which data resource we're interested in (`myactivity.search`).  After we've authenticated with Google, the user has agreed to share their data and has validated the length of time the app has access to the data, we can then start to request the users data.

Here’s the function that kicks this off in `main.js`:

```javascript
async function initiateDataPortabilityArchive(accessToken, resources = ['myactivity.search'], start, stop) {
  const url = 'https://dataportability.googleapis.com/v1/portabilityArchive:initiate';
  const body = JSON.stringify({ "resources": resources, 
                                "start_time": start,
                                "end_time": stop  
                              });

  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body,
  };
}
```

This call doesn't return the data directly. Instead, it returns a `jobId` for a long-running operation that we need to monitor within the application.  When triggered the UI will look something like this:

![FrontEnd Fetching the Data](/docs/screenshots/app_logged_in.png "UI Fetching the Job")

### Checking the Job Status

We then poll the `archiveJobs/portabilityArchiveState` endpoint using the `jobId`. We check the job's state periodically until it becomes `COMPLETE`.

This polling logic is handled by the `checkJob` function in `main.js`:

```javascript
async function checkJob(accessToken, jobID) {
    const url = 'https://dataportability.googleapis.com/v1/archiveJobs/'+jobID+'/portabilityArchiveState';
  
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      }
    };
  
    // ... fetch logic ...
}
```

![Fetching Job from the DP API Endpoint](/docs/screenshots/fetching_job.png "Fetching the Job")

Once the job is complete, the API provides signed URLs from a temporary Google Storage Bucked which we can download the data archive from.  In this case, this is a zip file containing the user's search history in JSON format.  At this point the app will unzip the file and store it on the local filesystem so that we can use the data in the next step.

![Data Downloaded](/docs/screenshots/data_downloaded.png "Data Downloaded")

---
## 2. Weaving a Narrative with Gemini 2.5 Flash ✍️

This is where the magic happens. After extracting the search queries from the downloaded JSON, we use Google's Gemini 2.5 Flash model to generate a story using a custom prompt.  I chose this model for its speed, large context window, and low price point which makes it perfect for creating long stories quickly when the user requests them.

The core of this process is in the `generateStory` function in `main.js` file.

### Crafting the Prompt

The quality of an AI-generated story depends heavily on the prompt. We use a detailed system instruction to guide the model, telling the model to act as a creative storyteller and adhere to a strict output format (Title on the first line, then the story).  A top tip for you, if you're struggling with creating a detailed prompt yourself then just ask [Gemini](https://gemini.google.com/) to help flesh out the details for you.  This is the prompt I used within the application to generate the story. 

```javascript
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `
    
    Your Role: You are a creative storyteller AI. Your primary function is to generate a short story based on the user's provided search terms, following a strict output format.

    **Strict Output Format (Follow these rules without exception):**

    1.  **Line 1: Title:** The very first line of your output must be the story's title.
    2.  **Title Constraints:** The title must be **7 words or fewer**. It should not be enclosed in quotes or any other punctuation.
    3.  **Line Breaks:** After the title, you must insert exactly **two** new line characters which are \n\n.
    4.  **Body:** Following the two new lines, write the story itself.
    // ... more instructions ...
    `
});

const result = await model.generateContent("Create a story based on my recent searches: " + searchHistory);
```

We feed the model a random sample of 50 search terms and let it work its creative magic. It's important to note here that each search term is on a new line which I found in testing to be the best for generating a good story from the model. The ease of switching models in Vertex AI means we could easily swap to a more powerful model like Gemini 2.5 Pro (gemini-2.5-pro) with a single line change if we wanted to experiment with different narrative styles.  Most models in the [GenAI family have a retirement date](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions#latest_stable_models) so being able to update these later is important. 

Once finished we get a new story created from our Search History

![StoryTime](/docs/screenshots/jobs_list.png "List of Stories")

---

## 3. Visualising the Story 🗣️

Now that we have a story and a title we need to create a custom background image for the story page.  The background image is created by the Imagen model on VertexAI and returns the first image.  For the app I used the prompt 

```A beautiful and evocative background image for a story. The story starts like this: ${storyText}. The image should be high-quality, photorealistic, with cinematic and dramatic lighting and fit with a dark background which is currently black around the side.```

Each request to Imagen can create up to 4 images based on the prompt given, and so we just pick the first one that comes back, convert the Base64 Encoded image into an image buffer and then save it to the local filesystem. 

```javascript
async function generateBackgroundImage(jobID, storyText, imgPath){
    // POST data to the model here
    ....

    const data = await response.json();

    if (data.predictions && data.predictions.length > 0 && data.predictions[0].bytesBase64Encoded) {
      const imageBase64 = data.predictions[0].bytesBase64Encoded;
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      fs.writeFileSync(imgPath, imageBuffer);
      console.log(`Background image saved to ${imgPath}`);
    } else {
      console.error('No image predictions found in API response.');
    }
  } catch (error) {
    console.error('Error generating background image:', error);
  }
}
```
We now have a nice background image to go with our story which changes every time based on the story that's passed to the model

![Example Story](/docs/screenshots/example_story.png "Example Story")

---

## 4. Giving Your Story a Voice with Cloud Text-to-Speech 🗣️

To make the experience more immersive, we convert the generated story into an audio narration. While Google's Chirp models are state-of-the-art for speech-to-speech and other advanced use cases, for direct and high-quality text-to-speech synthesis, the [Cloud Text-to-Speech API](https://cloud.google.com/text-to-speech) is the perfect tool.

We use a high-fidelity "Studio" voice to give the story a rich, human-like quality. The implementation is straightforward, as seen in the `synthesizeText` function in `main.js`:

```javascript
async function synthesizeText(text, voiceName = 'en-GB-Studio-C', outputFile = 'output.mp3') {
    const client = new TextToSpeechClient();
  
    text = text.replace("###", "").replace("##", "").replace("#", "");

    const request = {
      input: {text: text},
      voice: {languageCode: 'en-GB', name: voiceName},
      audioConfig: {audioEncoding: 'MP3'},
    };
  
    const [response] = await client.synthesizeSpeech(request);
    const writeStream = require('fs').createWriteStream(outputFile);
    writeStream.write(response.audioContent);
    writeStream.end();
    console.log(`Audio content written to file: ${outputFile}`);
}
```

We simply instantiate the client, build a request with our text and desired voice configuration (`en-GB-Studio-C`), and stream the resulting audio content directly into an MP3 file.

---

## Conclusion

The "My Search Story" project is a fun demonstration of how different Google Cloud and AI services can be orchestrated to create a deeply personal and creative user experience. By combining the **Data Portability API**, the generative power of **Gemini**, and the clarity of **Cloud Text-to-Speech**, we can turn a simple list of search queries into a unique piece of digital art.

If you're brave enough then clone the repository, set it up with your own credentials, and see what kind of stories your search history has to tell!


