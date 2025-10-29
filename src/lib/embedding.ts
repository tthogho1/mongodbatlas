import {
  Processor,
  AutoProcessor,
  RawImage,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  PreTrainedTokenizer,
} from '@xenova/transformers';

class Embedding {
  private model: CLIPVisionModelWithProjection | null = null;
  private tokenizer: PreTrainedTokenizer | null = null;
  private textModel: CLIPTextModelWithProjection | null = null;
  private imageProcessor: Processor | null = null;

  constructor() {
    this.initializeModels();
  }

  private async initializeModels() {
    const model_id = process.env.MODEL_ID;
    console.log(`start initialize model ${model_id}`);

    this.model = await CLIPVisionModelWithProjection.from_pretrained(model_id as string);
    this.tokenizer = await AutoTokenizer.from_pretrained(model_id as string);
    this.textModel = await CLIPTextModelWithProjection.from_pretrained(model_id as string);
    this.imageProcessor = await AutoProcessor.from_pretrained(model_id as string);

    console.log(`end initialize model ${model_id}`);
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    if (this.tokenizer === null || this.textModel === null) {
      throw new Error('Model not initialized');
    }
    const textInputs = await this.tokenizer(text, { padding: true, truncation: true });
    const { text_embeds } = await this.textModel(textInputs);
    return Array.from(text_embeds.data);
  }

  async getImageEmbedding(url: string): Promise<number[]> {
    if (!this.imageProcessor || !this.model) {
      throw new Error('Model not initialized');
    }

    const image = await RawImage.read(url);
    const inputs = await this.imageProcessor(image);
    const embeds = await this.model(inputs);
    return Array.from(embeds.image_embeds.data);
  }

  async getBlobImgEmbedding(image: Blob): Promise<number[]> {
    if (!this.imageProcessor || !this.model) {
      throw new Error('Model not initialized');
    }

    const inputImage = await RawImage.fromBlob(image);
    const inputs = await this.imageProcessor(inputImage);
    const embeds = await this.model(inputs);
    return Array.from(embeds.image_embeds.data);
  }
}

export { Embedding };
