import { Test, TestingModule } from '@nestjs/testing';
import { PixQrCodeService } from './PixQrCodeService';

describe('PixQrCodeService', () => {
  let service: PixQrCodeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PixQrCodeService],
    }).compile();

    service = module.get<PixQrCodeService>(PixQrCodeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generatePixQrCode', () => {
    it('should generate pix qr code data successfully with valid input', () => {
      const mockPixData = {
        qr_code: '00020126360014br.gov.bcb.pix',
        image_url_png: 'https://example.com/qr.png',
        expires_at: 1700000000,
        amount: 1000,
        currency: 'BRL',
      };

      const result = service.generatePixQrCode(mockPixData);

      expect(result).toEqual({
        qr_code: '00020126360014br.gov.bcb.pix',
        qr_code_png: 'https://example.com/qr.png',
        expires_at: 1700000000,
        amount: 1000,
        currency: 'BRL',
      });
    });

    it('should handle missing optional fields gracefully', () => {
      const mockPixData = {
        qr_code: '00020126360014br.gov.bcb.pix',
        // missing image_url_png, expires_at, amount
      };

      const result = service.generatePixQrCode(mockPixData);

      expect(result).toEqual({
        qr_code: '00020126360014br.gov.bcb.pix',
        qr_code_png: '',
        expires_at: null,
        amount: 0,
        currency: 'BRL',
      });
    });

    it('should handle empty object input gracefully', () => {
      const mockPixData = {};

      const result = service.generatePixQrCode(mockPixData);

      expect(result).toEqual({
        qr_code: '',
        qr_code_png: '',
        expires_at: null,
        amount: 0,
        currency: 'BRL',
      });
    });

    it('should throw an error if input is null or undefined', () => {
      expect(() => service.generatePixQrCode(null as any)).toThrow(
        'Erro ao gerar QR Code PIX',
      );
    });
  });

  describe('validatePixData', () => {
    it('should return true when all required fields are present', () => {
      const validData = {
        qr_code: 'some-code',
        amount: 100,
        currency: 'BRL',
      };
      expect(service.validatePixData(validData)).toBe(true);
    });

    it('should return false when data is null or undefined', () => {
      expect(service.validatePixData(null as any)).toBe(false);
      expect(service.validatePixData(undefined as any)).toBe(false);
    });

    it('should return false when required fields are missing', () => {
      const invalidData = {
        qr_code: 'some-code',
        // missing amount and currency
      };
      expect(service.validatePixData(invalidData as any)).toBe(false);
    });

    it('should return false when amount is missing', () => {
      const invalidData = {
        qr_code: 'some-code',
        currency: 'BRL',
      };
      expect(service.validatePixData(invalidData as any)).toBe(false);
    });
  });

  describe('formatPixAmount', () => {
    it('should format amount correctly for valid input', () => {
      const amount = 1000; // 10.00
      const result = service.formatPixAmount(amount);
      // Using regex to handle potential non-breaking space characters in currency formatting
      expect(result).toMatch(/R\$\s?10,00/);
    });

    it('should format zero correctly', () => {
      const amount = 0;
      const result = service.formatPixAmount(amount);
      expect(result).toMatch(/R\$\s?0,00/);
    });

    it('should handle negative amounts correctly', () => {
      const amount = -1000; // -10.00
      const result = service.formatPixAmount(amount);
      expect(result).toMatch(/-R\$\s?10,00/);
    });
  });

  describe('getTimeUntilExpiration', () => {
    it('should return the correct remaining time in seconds for a future timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const futureTime = now + 3600; // 1 hour from now
      const result = service.getTimeUntilExpiration(futureTime);
      expect(result).toBe(3600);
    });

    it('should return 0 if the timestamp is in the past', () => {
      const now = Math.floor(Date.now() / 1000);
      const pastTime = now - 3600; // 1 hour ago
      const result = service.getTimeUntilExpiration(pastTime);
      expect(result).toBe(0);
    });

    it('should return 0 if expiresAt is null or undefined', () => {
      expect(service.getTimeUntilExpiration(null as any)).toBe(0);
      expect(service.getTimeUntilExpiration(undefined as any)).toBe(0);
    });

    it('should return 0 if expiresAt is 0', () => {
      expect(service.getTimeUntilExpiration(0)).toBe(0);
    });
  });
});
