import { Test, TestingModule } from '@nestjs/testing';
import { StripeFilesService } from './StripeFiles.service';

// ---------------------------------------------------------------------------
// Mock do módulo 'stripe'.
// O mock deve ser definido **antes** da importação do serviço, pois o
// serviço cria a instância do Stripe no momento da importação (const
// applicationStripe = Stripe(process.env.SSECRET);).
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  // Retorna uma função mock (construtor) que, ao ser chamada, devolve o
  // objeto esperado pelo serviço.
  return jest.fn().mockImplementation(() => ({
    files: {
      // O método create será sobrescrito nos testes individuais.
      create: jest.fn(),
    },
  }));
});

describe('StripeFilesService', () => {
  let service: StripeFilesService;
  // Referência ao mock interno do Stripe para facilitar as asserções.
  const stripeMock = (require('stripe') as jest.Mock).mock.results[0].value;
  const createFileMock = stripeMock.files.create as jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StripeFilesService],
    }).compile();

    service = module.get<StripeFilesService>(StripeFilesService);
    // Resetar chamadas e implementações entre testes.
    createFileMock.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createFile', () => {
    const mockMulterFile = {
      buffer: Buffer.from('dummy content'),
      originalname: 'dummy.txt',
      mimetype: 'text/plain',
    } as any; // uso de `as any` conforme política de fixtures.

    it('should successfully create a file on Stripe (happy path)', async () => {
      // Arrange
      const expectedResult = { id: 'file_123', purpose: 'test-purpose' } as any;
      createFileMock.mockResolvedValueOnce(expectedResult);

      // Act
      const result = await service.createFile('test-purpose', mockMulterFile);

      // Assert
      expect(createFileMock).toHaveBeenCalledTimes(1);
      expect(createFileMock).toHaveBeenCalledWith({
        purpose: 'test-purpose',
        file: {
          data: mockMulterFile.buffer,
          name: mockMulterFile.originalname,
          type: mockMulterFile.mimetype,
        },
      });
      expect(result).toBeDefined();
      expect(result).toEqual(expectedResult);
    });

    it('should propagate Stripe errors (sad path)', async () => {
      // Arrange
      const error = new Error('Stripe service unavailable');
      createFileMock.mockRejectedValueOnce(error);

      // Act & Assert
      await expect(
        service.createFile('any-purpose', mockMulterFile),
      ).rejects.toThrow('Stripe service unavailable');

      expect(createFileMock).toHaveBeenCalledTimes(1);
    });

    it('should call Stripe with correct payload when different purpose is provided', async () => {
      // Arrange
      const purpose = 'identity_document';
      const expectedResult = { id: 'file_456', purpose } as any;
      createFileMock.mockResolvedValueOnce(expectedResult);

      // Act
      const result = await service.createFile(purpose, mockMulterFile);

      // Assert
      expect(createFileMock).toHaveBeenCalledWith({
        purpose,
        file: {
          data: mockMulterFile.buffer,
          name: mockMulterFile.originalname,
          type: mockMulterFile.mimetype,
        },
      });
      expect(result).toEqual(expectedResult);
    });
  });
});
