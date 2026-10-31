import { Test, TestingModule } from '@nestjs/testing';
import { FixDuplicatedLoginService } from './FixDuplicatedLogin.service';
import { DatabaseService } from 'database.service';

describe('FixDuplicatedLoginService', () => {
  let service: FixDuplicatedLoginService;
  let databaseService: any;

  beforeEach(async () => {
    databaseService = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixDuplicatedLoginService,
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
      ],
    }).compile();

    service = module.get<FixDuplicatedLoginService>(FixDuplicatedLoginService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fix', () => {
    it('should execute fix successfully and delete duplicated logins (Happy Path)', async () => {
      // Given (Arrange)
      const mockResult = { affected: 5, raw: [] };
      databaseService.executeQuery = jest
        .fn()
        .mockResolvedValueOnce(mockResult as any);

      // When (Act)
      await service.fix();

      // Then (Assert)
      expect(databaseService.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          'delete from client_login client where client.id in',
        ),
      );
      expect(databaseService.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "cl2.login_date < cl.login_date + (1 ||' minutes')::interval",
        ),
      );
    });

    it('should propagate errors when database execution fails (Sad Path)', async () => {
      // Given (Arrange)
      const error = new Error('Database connection failed');
      databaseService.executeQuery = jest.fn().mockRejectedValueOnce(error);

      // When & Then (Act & Assert)
      await expect(service.fix()).rejects.toThrow('Database connection failed');
    });

    it('should handle case where no duplicates are found (Empty State)', async () => {
      // Given (Arrange)
      const mockResult = { affected: 0, raw: [] };
      databaseService.executeQuery = jest
        .fn()
        .mockResolvedValueOnce(mockResult as any);

      // When (Act)
      await service.fix();

      // Then (Assert)
      expect(databaseService.executeQuery).toHaveBeenCalled();
    });

    it('should use correct SQL logic to identify duplicates within same client (Business Logic)', async () => {
      // Given (Arrange)
      databaseService.executeQuery = jest
        .fn()
        .mockResolvedValueOnce({ affected: 0 } as any);

      // When (Act)
      await service.fix();

      // Then (Assert)
      expect(databaseService.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('cl.client = cl2.client'),
      );
      expect(databaseService.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('cl.id <> cl2.id'),
      );
      expect(databaseService.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('cl2.login_date > cl.login_date'),
      );
    });
  });
});
