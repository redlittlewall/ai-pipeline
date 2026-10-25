import { Test, TestingModule } from '@nestjs/testing';
import { DashboardCreatedUserService } from './DashboardCreatedUser.service';
import { DatabaseService } from 'database.service';
import { DashboardUtilsService } from './DashboardUtils.service';

describe('DashboardCreatedUserService', () => {
  let service: DashboardCreatedUserService;
  let databaseService: any;
  let dashboardUtilsService: any;

  beforeEach(async () => {
    databaseService = {
      executeQuery: jest.fn().mockResolvedValue([]),
    };
    dashboardUtilsService = {
      somaTotal: jest.fn().mockReturnValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardCreatedUserService,
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
        {
          provide: DashboardUtilsService,
          useValue: dashboardUtilsService,
        },
      ],
    }).compile();

    service = module.get<DashboardCreatedUserService>(
      DashboardCreatedUserService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboardCreatedUsers', () => {
    it('should execute getDashboardCreatedUsers successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.getDashboardCreatedUsers(
        '2023-01-01' as any,
        '2023-01-31' as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });

  describe('getAnonimosLine', () => {
    it('should execute getAnonimosLine successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.getAnonimosLine(
        '2023-01-01' as any,
        '2023-01-31' as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });

  describe('getArtistsLine', () => {
    it('should execute getArtistsLine successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.getArtistsLine(
        '2023-01-01' as any,
        '2023-01-31' as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });

  describe('getClientLine', () => {
    it('should execute getClientLine successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.getClientLine(
        '2023-01-01' as any,
        '2023-01-31' as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });

  describe('getTotalLine', () => {
    it('should execute getTotalLine successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.getTotalLine(
        '2023-01-01' as any,
        '2023-01-31' as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });

  describe('executeGenericQuery', () => {
    it('should execute executeGenericQuery successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.executeGenericQuery(
        '2023-01-01' as any,
        '2023-01-31' as any,
        true as any,
        true as any,
        'client' as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });

  describe('executeProfileStatusCountQuery', () => {
    it('should execute executeProfileStatusCountQuery successfully', async () => {
      // Given (Arrange)
      // Configure injected repository/service mocks if needed

      // When (Act)
      const result = await service.executeProfileStatusCountQuery(
        '2023-01-01' as any,
        '2023-01-31' as any,
        true as any,
      );

      // Then (Assert)
      expect(result).toBeDefined();
    });
  });
});
