import { Test, TestingModule } from '@nestjs/testing';
import { AiVisionService } from './AiVision.service';
import { AiCatalogService } from './AiCatalog.service';
import { AiHealthService } from './AiHealth.service';

jest.mock('sharp', () => {
  return jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('compressed-image-data')),
  }));
});

jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({
    data: Buffer.from('axios-image-data'),
  }),
}));

const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

describe('AiVisionService', () => {
  let service: AiVisionService;
  let aiCatalogService: any;
  let aiHealthService: any;

  beforeEach(async () => {
    aiCatalogService = {
      getBodyPartNames: jest.fn().mockReturnValue(['Arm', 'Leg']),
      getColorNames: jest.fn().mockReturnValue(['Black', 'Red']),
      getSizeLabels: jest.fn().mockReturnValue(['Small', 'Medium']),
      getSizes: jest
        .fn()
        .mockReturnValue([{ name: 'Small' }, { name: 'Medium' }]),
      getStyleNames: jest.fn().mockReturnValue(['Realism', 'Tribal']),
      hasCatalog: jest.fn().mockReturnValue(true),
      resolveBodyPartId: jest.fn().mockReturnValue('body-part-id-1'),
      resolveSizeByName: jest.fn().mockReturnValue('size-id-1'),
      resolveStyleIds: jest.fn().mockReturnValue(['style-id-1']),
    };

    aiHealthService = {
      recordFailure: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiVisionService,
        {
          provide: AiCatalogService,
          useValue: aiCatalogService,
        },
        {
          provide: AiHealthService,
          useValue: aiHealthService,
        },
      ],
    }).compile();

    service = module.get<AiVisionService>(AiVisionService);
    mockGenerateContent.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('classifyTattoo', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.GEMINI_API_KEY = 'mock-key';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return null when AI_CLASSIFY_ENABLED is false', async () => {
      process.env.AI_CLASSIFY_ENABLED = 'false';

      const result = await service.classifyTattoo([
        'http://example.com/image.jpg',
      ]);

      expect(result).toBeNull();
    });

    it('should return null when API key is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_GENAI_API_KEY;
      delete process.env.API_KEY;

      const result = await service.classifyTattoo([
        'http://example.com/image.jpg',
      ]);

      expect(result).toBeNull();
    });

    it('should return null when imageUrls list is empty or null', async () => {
      const resultEmpty = await service.classifyTattoo([]);
      const resultNull = await service.classifyTattoo(null as any);
      const resultFirstEmpty = await service.classifyTattoo(['']);

      expect(resultEmpty).toBeNull();
      expect(resultNull).toBeNull();
      expect(resultFirstEmpty).toBeNull();
    });

    it('should return null when catalog is empty', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(false);

      const result = await service.classifyTattoo([
        'http://example.com/image.jpg',
      ]);

      expect(result).toBeNull();
      expect(aiCatalogService.hasCatalog).toHaveBeenCalled();
    });

    it('should return null gracefully when image fetching fails', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(true);

      const result = await service.classifyTattoo([
        'invalid-url-string-not-base64-or-http',
      ]);

      expect(result).toBeNull();
    });

    it('should classify tattoo successfully from http url (Happy Path)', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(true);
      const mockJsonResponse = JSON.stringify({
        is_tattoo: true,
        is_skin_tattoo: true,
        body_part: 'Arm',
        size: 'Medium',
        styles: ['Realism'],
        description: 'A realistic tattoo on arm',
        is_content_appropriate: true,
        is_colorful: true,
        detected_colors: ['Black', 'Red'],
        confidence: 0.95,
      });

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => mockJsonResponse,
        },
      });

      const result = await service.classifyTattoo([
        'http://example.com/image.jpg',
      ]);

      expect(result).toBeDefined();
      expect(result?.isTattoo).toBe(true);
      expect(result?.bodyPartId).toBe('body-part-id-1');
      expect(result?.sizeId).toBe('size-id-1');
      expect(result?.styleIds).toEqual(['style-id-1']);
      expect(aiHealthService.recordSuccess).toHaveBeenCalled();
    });

    it('should classify tattoo from data URI input', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(true);
      const mockJsonResponse = JSON.stringify({
        is_tattoo: true,
        is_skin_tattoo: false,
        size: 'Small',
        styles: [],
        confidence: 0.8,
      });

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => `\`\`\`json\n${mockJsonResponse}\n\`\`\``,
        },
      });

      const result = await service.classifyTattoo([
        'data:image/jpeg;base64,dGVzdA==',
      ]);

      expect(result).toBeDefined();
      expect(result?.isTattoo).toBe(true);
      expect(result?.isSkinTattoo).toBe(false);
      expect(aiHealthService.recordSuccess).toHaveBeenCalled();
    });

    it('should record failure in health service when AI model throws error', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(true);
      mockGenerateContent.mockRejectedValue(new Error('API failure'));

      const result = await service.classifyTattoo([
        'http://example.com/image.jpg',
      ]);

      expect(result).toBeNull();
      expect(aiHealthService.recordFailure).toHaveBeenCalled();
    });
  });

  describe('classifyImageBuffer', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.GEMINI_API_KEY = 'mock-key';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return null when AI_CLASSIFY_ENABLED is false', async () => {
      process.env.AI_CLASSIFY_ENABLED = 'false';

      const result = await service.classifyImageBuffer(Buffer.from('test'));

      expect(result).toBeNull();
    });

    it('should return null when API key is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_GENAI_API_KEY;
      delete process.env.API_KEY;

      const result = await service.classifyImageBuffer(Buffer.from('test'));

      expect(result).toBeNull();
    });

    it('should return null when buffer is empty or null', async () => {
      const resultNull = await service.classifyImageBuffer(null as any);
      const resultEmpty = await service.classifyImageBuffer(Buffer.from(''));

      expect(resultNull).toBeNull();
      expect(resultEmpty).toBeNull();
    });

    it('should return null when catalog is empty', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(false);

      const result = await service.classifyImageBuffer(Buffer.from('test'));

      expect(result).toBeNull();
      expect(aiCatalogService.hasCatalog).toHaveBeenCalled();
    });

    it('should classify image buffer successfully (Happy Path)', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(true);
      const mockJsonResponse = JSON.stringify({
        is_tattoo: true,
        is_skin_tattoo: true,
        body_part: 'Arm',
        size: 'Small',
        styles: ['Tribal'],
        description: 'Tribal tattoo',
        is_content_appropriate: true,
        is_colorful: false,
        detected_colors: ['Black'],
        confidence: 0.9,
      });

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => mockJsonResponse,
        },
      });

      const result = await service.classifyImageBuffer(
        Buffer.from('valid-image-data'),
      );

      expect(result).toBeDefined();
      expect(result?.isTattoo).toBe(true);
      expect(result?.styleIds).toEqual(['style-id-1']);
      expect(aiHealthService.recordSuccess).toHaveBeenCalled();
    });

    it('should handle non-tattoo images correctly', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(true);
      const mockJsonResponse = JSON.stringify({
        is_tattoo: false,
        is_skin_tattoo: false,
        is_content_appropriate: true,
      });

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => mockJsonResponse,
        },
      });

      const result = await service.classifyImageBuffer(
        Buffer.from('valid-image-data'),
      );

      expect(result).toBeDefined();
      expect(result?.isTattoo).toBe(false);
      expect(result?.isSkinTattoo).toBe(false);
      expect(result?.bodyPartId).toBeNull();
    });
  });

  describe('classifyImageBase64', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.GEMINI_API_KEY = 'mock-key';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return null when input base64 string is invalid or empty', async () => {
      const resultNull = await service.classifyImageBase64(null as any);
      const resultEmpty = await service.classifyImageBase64('');
      const resultNumber = await service.classifyImageBase64(123 as any);

      expect(resultNull).toBeNull();
      expect(resultEmpty).toBeNull();
      expect(resultNumber).toBeNull();
    });

    it('should strip data URI prefix and execute real buffer logic successfully', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(true);
      const mockJsonResponse = JSON.stringify({
        is_tattoo: true,
        is_skin_tattoo: true,
        body_part: 'Arm',
        size: 'Medium',
        confidence: 0.92,
      });

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => mockJsonResponse,
        },
      });

      const dataUri = 'data:image/jpeg;base64,dGVzdA==';
      const result = await service.classifyImageBase64(dataUri, 1000);

      expect(result).toBeDefined();
      expect(result?.isTattoo).toBe(true);
      expect(aiHealthService.recordSuccess).toHaveBeenCalled();
    });

    it('should process plain base64 string correctly', async () => {
      aiCatalogService.hasCatalog.mockReturnValue(true);
      const mockJsonResponse = JSON.stringify({
        is_tattoo: true,
        is_skin_tattoo: true,
        body_part: 'Leg',
        size: 'Medium',
        confidence: 0.88,
      });

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => mockJsonResponse,
        },
      });

      const plainBase64 = 'dGVzdA==';
      const result = await service.classifyImageBase64(plainBase64, 1500);

      expect(result).toBeDefined();
      expect(result?.isTattoo).toBe(true);
      expect(aiHealthService.recordSuccess).toHaveBeenCalled();
    });
  });
});
