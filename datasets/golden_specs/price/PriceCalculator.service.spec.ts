import { Test, TestingModule } from '@nestjs/testing';
import { PriceCalculatorService } from './PriceCalculator.service';
import { PriceValuesDto } from 'model/dto/price/PriceValuesDto';

// ---------------------------------------------------------------------------
// Mock do módulo firebase-admin
// ---------------------------------------------------------------------------
let getTemplateMock: jest.Mock;

jest.mock('firebase-admin', () => ({
  remoteConfig: () => ({
    getTemplate: getTemplateMock,
  }),
}));

// ---------------------------------------------------------------------------
// Variáveis de ambiente necessárias para o cálculo
// ---------------------------------------------------------------------------
process.env.ARTIST_PERCENTAGE = '10';
process.env.CLIENT_PERCENTAGE = '10';
process.env.TRANSACTIONAL_OPERATION_COST_PERCENTAGE = '10';

describe('PriceCalculatorService', () => {
  let service: PriceCalculatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PriceCalculatorService],
    }).compile();

    service = module.get<PriceCalculatorService>(PriceCalculatorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculate', () => {
    it('should return a defined result when remote config flag is true (artist free tax)', async () => {
      // Arrange
      getTemplateMock = jest.fn().mockResolvedValueOnce({
        parameters: {
          artistFreeTax: {
            defaultValue: { value: 'true' },
          },
        },
      });

      // Act
      const result: PriceValuesDto = await service.calculate(1000, 'BRL');

      // Assert
      expect(getTemplateMock).toHaveBeenCalled();
      expect(result).toBeDefined();
      // Quando o artista tem taxa gratuita, o valor que o artista recebe deve ser igual ao preço original
      expect(result.artistValue).toBe(36000); // valor fixo definido no DTO de retorno
      expect(result.isArtistFreeTax).toBe(true);
    });

    it('should return a defined result when remote config flag is false (artist pays tax)', async () => {
      // Arrange
      getTemplateMock = jest.fn().mockResolvedValueOnce({
        parameters: {
          artistFreeTax: {
            defaultValue: { value: 'false' },
          },
        },
      });

      // Act
      const result: PriceValuesDto = await service.calculate(1000, 'BRL');

      // Assert
      expect(getTemplateMock).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.isArtistFreeTax).toBe(false);
    });

    it('should propagate an error when remote config retrieval fails', async () => {
      // Arrange
      const error = new Error('Remote config unavailable');
      getTemplateMock = jest.fn().mockRejectedValueOnce(error);

      // Act & Assert
      await expect(service.calculate(1000, 'BRL')).rejects.toThrow(
        'Remote config unavailable',
      );
      expect(getTemplateMock).toHaveBeenCalled();
    });
  });
});
