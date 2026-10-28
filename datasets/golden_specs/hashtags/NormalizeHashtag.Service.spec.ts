import { Test, TestingModule } from '@nestjs/testing';
import { NormalizeHashtagService } from './NormalizeHashtag.Service';

describe('NormalizeHashtagService', () => {
  let service: NormalizeHashtagService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NormalizeHashtagService],
    }).compile();

    service = module.get<NormalizeHashtagService>(NormalizeHashtagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('normalize', () => {
    it('should normalize a simple hashtag by capitalizing the first letter and lowercasing the rest', () => {
      const result = service.normalize('programming');
      expect(result).toBe('Programming');
    });

    it('should replace spaces with underscores', () => {
      const result = service.normalize('software engineering');
      expect(result).toBe('Software_engineering');
    });

    it('should trim leading and trailing spaces', () => {
      const result = service.normalize('  nestJS  ');
      expect(result).toBe('Nestjs');
    });

    it('should remove accents/diacritics from characters', () => {
      const result = service.normalize('programação');
      expect(result).toBe('Programacao');
    });

    it('should handle strings with multiple spaces by replacing them with underscores', () => {
      const result = service.normalize('clean    code');
      expect(result).toBe('Clean_code');
    });

    it('should handle mixed casing and normalize to Sentence case', () => {
      const result = service.normalize('tYpEsCrIpT');
      expect(result).toBe('Typescript');
    });

    it('should handle complex strings with accents and spaces combined', () => {
      const result = service.normalize('  Atenção técnica  ');
      expect(result).toBe('Atencao_tecnica');
    });
  });
});
