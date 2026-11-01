import { Test, TestingModule } from '@nestjs/testing';
import { EmailComposerService } from './EmailComposerService';

describe('EmailComposerService', () => {
  let service: EmailComposerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailComposerService],
    }).compile();

    service = module.get<EmailComposerService>(EmailComposerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('composeEmail', () => {
    const defaultParams = {
      theme: 'client' as const,
      recipientName: 'João',
      recipientEmail: 'joao@example.com',
      ctaText: 'Acessar',
      ctaLink: 'https://link.com',
      title: 'Olá, João!',
      messageBody: '<p>Corpo do email</p>',
    };

    it('should compose email with client theme successfully (Happy Path)', async () => {
      // Act
      const result = await service.composeEmail(defaultParams);

      // Assert
      expect(result).toBeDefined();
      expect(result).toContain(
        'Olá, <span class="name-highlight" style="color: #FF2E63; font-weight: 700;">João</span>!',
      );
      expect(result).toContain(defaultParams.ctaText);
      expect(result).toContain(defaultParams.ctaLink);
      expect(result).toContain('#FF2E63'); // Client highlight color
    });

    it('should compose email with artist theme successfully', async () => {
      // Act
      const result = await service.composeEmail({
        ...defaultParams,
        theme: 'artist',
      });

      // Assert
      expect(result).toBeDefined();
      expect(result).toContain(
        'Olá, <span class="name-highlight" style="color: #00DAE9; font-weight: 700;">João</span>!',
      );
      expect(result).toContain('#00DAE9'); // Artist highlight color
      expect(result).toContain('box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);');
    });

    it('should handle empty recipientName by showing generic greeting', async () => {
      // Act
      const result = await service.composeEmail({
        ...defaultParams,
        recipientName: '',
      });

      // Assert
      expect(result).toContain('Olá!</p>');
      expect(result).not.toContain('class="name-highlight"');
    });

    it('should handle whitespace recipientName by showing generic greeting', async () => {
      // Act
      const result = await service.composeEmail({
        ...defaultParams,
        recipientName: '   ',
      });

      // Assert
      expect(result).toContain('Olá!</p>');
      expect(result).not.toContain('class="name-highlight"');
    });

    it('should include extra footer when provided', async () => {
      // Arrange
      const extraFooter = 'Mensagem de boas-vindas extra';

      // Act
      const result = await service.composeEmail({
        ...defaultParams,
        extraFooter,
      });

      // Assert
      expect(result).toContain(extraFooter);
    });

    it('should throw error when base template cannot be loaded (Sad Path)', async () => {
      // Arrange
      // Forcing cache to null to trigger readFileSync which will fail due to mock filesystem or path
      (service as any).cachedTemplate = null;
      const fs = require('fs');
      const spy = jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw new Error('File not found');
      });

      // Act & Assert
      await expect(service.composeEmail(defaultParams)).rejects.toThrow(
        'Email template not found',
      );

      spy.mockRestore();
    });
  });
});
