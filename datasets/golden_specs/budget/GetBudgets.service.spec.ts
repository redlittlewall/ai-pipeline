import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetBudgetsService } from './GetBudgets.service';
import { Budget } from 'model/budget/Budget.entity';
import { Artist } from 'model/users/Artist.entity';
import { BudgetNotifications } from 'model/budget/BudgetNotification.entity';
import { Notifications } from 'model/notification/Notifications.entity';
import { GetSizesService } from 'modules/tattoo/details/GetSizes.service';
import { GetStyleService } from 'modules/tattoo/style/GetStyles.service';
import { GetBudgetOffersService } from './offers/GetBudgetOffers.service';
import { GetBudgetSchedulesService } from './schedule/GetBudgetSchedules.service';
import { GetArtistAddressService } from 'modules/address/artist/GetArtistAddress.service';
import { GetBudgetChatMessagesService } from './chat/GetBudgetChatMessages.Service';
import { BudgetHasNotificationService } from './notification/BudgetHasNotification.service';
import { SocketGateWay } from 'modules/sockets/Socket.Gateway';
import { CalculateRefoundPercentageService } from 'modules/payment/actions/CalculateRefoundPercentage.service';
import { CalculateCurrentStepRepresentationService } from './CalculateCurrentStepRepresentation.service';
import { ClientService } from 'modules/users/Client.Service';
import { GetTattooPhotosService } from 'modules/tattoo/GetTattooPhotos.Service';
import { GetTattooMinimalService } from 'modules/tattoo/GetTattooMinimal.Service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalStatus } from 'enums/ApprovalStatus';
import { BudgetStatus } from 'enums/BudgetStatus';
import { BudgetType } from 'enums/BudgetType';
import { DropdownStatus } from 'enums/DropdownStatus';

describe('GetBudgetsService', () => {
  let service: GetBudgetsService;
  let budgetRepository: any;
  let artistRepository: any;
  let budgetNotificationsRepository: any;
  let notificationsRepository: any;
  let getSizesService: any;
  let getStyleService: any;
  let getBudgetOffersService: any;
  let getBudgetSchedulesService: any;
  let getArtistAddressService: any;
  let getBudgetChatMessagesService: any;
  let budgetHasNotificationService: any;
  let socketGateWay: any;
  let calculateRefoundPercentageService: any;
  let calculateCurrentStepRepresentationService: any;
  let clientService: any;
  let getTattooPhotosService: any;
  let getTattooMinimalService: any;

  beforeEach(async () => {
    const createQueryBuilderMock = () => {
      const qb: any = new Proxy(
        {},
        {
          get(target, prop) {
            if (prop === 'then') return undefined;
            if (!(prop in target)) {
              target[prop] = jest.fn().mockImplementation((...args: any[]) => {
                if (args.length > 0 && typeof args[0] === 'function') {
                  args[0](qb);
                } else if (
                  args.length > 0 &&
                  args[0] &&
                  typeof args[0].whereFactory === 'function'
                ) {
                  args[0].whereFactory(qb);
                }
                return qb;
              });
            }
            return target[prop];
          },
        },
      );
      qb.getOne = jest.fn().mockResolvedValue(null);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getCount = jest.fn().mockResolvedValue(0);
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      qb.execute = jest.fn().mockResolvedValue({ affected: 1, raw: [] });
      return qb;
    };

    const createMockRepository = () => {
      const qb = createQueryBuilderMock();
      return {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        findAndCount: jest.fn().mockResolvedValue([[], 0]),
        save: jest
          .fn()
          .mockImplementation((e: any) =>
            Promise.resolve({ id: 'mock-id', ...(e || {}) }),
          ),
        create: jest.fn().mockImplementation((e: any) => e),
        update: jest
          .fn()
          .mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        restore: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
        count: jest.fn().mockResolvedValue(0),
        exist: jest.fn().mockResolvedValue(false),
        remove: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
    };
    budgetRepository = createMockRepository();
    artistRepository = createMockRepository();
    budgetNotificationsRepository = createMockRepository();
    notificationsRepository = createMockRepository();
    getSizesService = {
      buildDto: jest.fn(),
    };
    getStyleService = {
      buildDto: jest.fn(),
    };
    getBudgetOffersService = {
      getApprovedOffer: jest.fn(),
      getLastValidOffer: jest.fn(),
      getPublicOffers: jest.fn(),
    };
    getBudgetSchedulesService = {
      getLastValidSchedule: jest.fn(),
    };
    getArtistAddressService = {
      get: jest.fn(),
    };
    getBudgetChatMessagesService = {
      getChatMessages: jest.fn(),
    };
    budgetHasNotificationService = {
      verify: jest.fn(),
    };
    socketGateWay = {
      updateNotifications: jest.fn(),
    };
    calculateRefoundPercentageService = {
      handle: jest.fn(),
    };
    calculateCurrentStepRepresentationService = {
      calculate: jest.fn(),
    };
    clientService = {
      getClientDto: jest.fn(),
    };
    getTattooPhotosService = {
      getByTattooId: jest.fn(),
    };
    getTattooMinimalService = {
      getMinimal: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetBudgetsService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: getRepositoryToken(BudgetNotifications),
          useValue: budgetNotificationsRepository,
        },
        {
          provide: getRepositoryToken(Notifications),
          useValue: notificationsRepository,
        },
        {
          provide: GetSizesService,
          useValue: getSizesService,
        },
        {
          provide: GetStyleService,
          useValue: getStyleService,
        },
        {
          provide: GetBudgetOffersService,
          useValue: getBudgetOffersService,
        },
        {
          provide: GetBudgetSchedulesService,
          useValue: getBudgetSchedulesService,
        },
        {
          provide: GetArtistAddressService,
          useValue: getArtistAddressService,
        },
        {
          provide: GetBudgetChatMessagesService,
          useValue: getBudgetChatMessagesService,
        },
        {
          provide: BudgetHasNotificationService,
          useValue: budgetHasNotificationService,
        },
        {
          provide: SocketGateWay,
          useValue: socketGateWay,
        },
        {
          provide: CalculateRefoundPercentageService,
          useValue: calculateRefoundPercentageService,
        },
        {
          provide: CalculateCurrentStepRepresentationService,
          useValue: calculateCurrentStepRepresentationService,
        },
        {
          provide: ClientService,
          useValue: clientService,
        },
        {
          provide: GetTattooPhotosService,
          useValue: getTattooPhotosService,
        },
        {
          provide: GetTattooMinimalService,
          useValue: getTattooMinimalService,
        },
      ],
    }).compile();

    service = module.get<GetBudgetsService>(GetBudgetsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBudgetByArtistId', () => {
    it('should throw ForbiddenException if artist is not approved', async () => {
      artistRepository.findOne.mockResolvedValueOnce({
        id: 'artist-1',
        status: ApprovalStatus.PENDING,
      } as any);

      await expect(
        service.getBudgetByArtistId(DropdownStatus.OPEN, 'artist-1', 0, 10),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return budget dtos when artist is approved', async () => {
      artistRepository.findOne.mockResolvedValueOnce({
        id: 'artist-1',
        status: ApprovalStatus.APPROVED,
      } as any);

      const mockBudget = {
        id: 'budget-1',
        owner: { id: 'user-1' },
        type: BudgetType.PRIVATE,
      };

      budgetRepository.find.mockResolvedValueOnce([mockBudget] as any);
      clientService.getClientDto.mockResolvedValue({ id: 'user-1' } as any);

      const result = await service.getBudgetByArtistId(
        DropdownStatus.OPEN,
        'artist-1',
        0,
        10,
      );

      expect(result).toHaveLength(1);
      expect(budgetRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('getPublicBudgets', () => {
    it('should execute getPublicBudgets successfully and return budget dtos', async () => {
      const mockBudget = {
        id: 'budget-public-1',
        owner: { id: 'owner-1' },
        type: BudgetType.PUBLIC,
      };

      budgetRepository.find.mockResolvedValueOnce([mockBudget] as any);
      getBudgetOffersService.getPublicOffers.mockResolvedValueOnce([]);

      const result = await service.getPublicBudgets(
        'artist-1',
        DropdownStatus.OPEN,
        0,
        10,
      );

      expect(result).toHaveLength(1);
      expect(budgetRepository.find).toHaveBeenCalled();
    });
  });

  describe('getMinimalBudgetById', () => {
    it('should throw NotFoundException if budget is not found', async () => {
      budgetRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getMinimalBudgetById('user-1', 'non-existent', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('should delete qrCode if selectQr is false', async () => {
      const mockBudget = {
        id: 'budget-1',
        qrCode: 'qr-code-data',
        owner: { id: 'user-1' },
      };
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);

      const result = await service.getMinimalBudgetById(
        'user-1',
        'budget-1',
        false,
      );

      expect(result).toBeDefined();
      expect(mockBudget.qrCode).toBeUndefined();
    });

    it('should keep qrCode if selectQr is true', async () => {
      const mockBudget = {
        id: 'budget-1',
        qrCode: 'qr-code-data',
        owner: { id: 'user-1' },
      };
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);

      const result = await service.getMinimalBudgetById(
        'user-1',
        'budget-1',
        true,
      );

      expect(result).toBeDefined();
      expect(result.qrCode).toEqual('qr-code-data');
    });
  });

  describe('getBudgetById', () => {
    it('should throw NotFoundException if budget does not exist', async () => {
      budgetRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getBudgetById('user-1', 'invalid-id', false, false),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set userId to budget owner when userId is null and admin is true', async () => {
      const mockBudget = {
        id: 'budget-1',
        owner: { id: 'owner-123' },
      };
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);

      const result = await service.getBudgetById(null, 'budget-1', false, true);

      expect(result).toBeDefined();
    });

    it('should update notifications and socket when view is true', async () => {
      const mockBudget = {
        id: 'budget-1',
        owner: { id: 'user-1' },
      };
      budgetRepository.findOne.mockResolvedValueOnce(mockBudget as any);

      await service.getBudgetById('user-1', 'budget-1', true, false);

      expect(budgetNotificationsRepository.update).toHaveBeenCalled();
      expect(notificationsRepository.update).toHaveBeenCalled();
      expect(socketGateWay.updateNotifications).toHaveBeenCalledWith('user-1');
    });
  });

  describe('byStatus', () => {
    it('should return minimal budget dtos for a user', async () => {
      const mockBudget = {
        id: 'budget-1',
        artistBudgetNumber: 1,
        title: 'Title',
        status: BudgetStatus.OPEN,
        type: BudgetType.PRIVATE,
        size: {},
        bodyPart: 'Arm',
        owner: { id: 'user-1' },
        finishedTattooClient: null,
        selectedArtist: null,
        approvedOffer: null,
        approvedSchedule: null,
        finalValidationAt: null,
        photos: [],
        colors: [],
        styles: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        refoundedAt: null,
      };

      budgetRepository.find.mockResolvedValueOnce([mockBudget] as any);
      clientService.getClientDto.mockResolvedValue({ id: 'user-1' } as any);
      getSizesService.buildDto.mockReturnValue({ id: 'size-1' } as any);
      calculateCurrentStepRepresentationService.calculate.mockReturnValue(1);
      budgetHasNotificationService.verify.mockResolvedValue(false);

      const result = await service.byStatus(
        'user-1',
        DropdownStatus.OPEN,
        0,
        10,
      );

      expect(result).toHaveLength(1);
      expect(budgetRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('getRealStatus', () => {
    it('should return open status list for DropdownStatus.OPEN', () => {
      const result = service.getRealStatus(DropdownStatus.OPEN);
      expect(result).toEqual(service.openStatus);
    });

    it('should return closed status list for DropdownStatus.CLOSED', () => {
      const result = service.getRealStatus(DropdownStatus.CLOSED);
      expect(result).toEqual(service.closedStatus);
    });

    it('should return em andamento status list for DropdownStatus.EM_ANDAMENTO', () => {
      const result = service.getRealStatus(DropdownStatus.EM_ANDAMENTO);
      expect(result).toEqual(service.emAndamentoStatus);
    });

    it('should return undefined for unknown status', () => {
      const result = service.getRealStatus('UNKNOWN' as any);
      expect(result).toBeUndefined();
    });
  });

  describe('toBudgetDto', () => {
    it('should calculate chats, offers, and refund values properly', async () => {
      const mockBudget = {
        id: 'budget-1',
        owner: { id: 'owner-1' },
        type: BudgetType.PUBLIC,
        status: BudgetStatus.PUBLIC_BUDGET_OFFER,
        approvedSchedule: { date: new Date() },
        approvedOffer: { price: { totalValue: 1000 } },
        finishedTattooArtist: {
          id: 'tattoo-1',
          owner: { id: 'artist-user-1' },
        },
        finishedTattooClient: { id: 'tattoo-2', owner: { id: 'owner-1' } },
        selectedArtist: { id: 'artist-1', client: { id: 'artist-user-1' } },
        inspiredBy: { id: 'tattoo-inspired' },
        cancelledBy: { id: 'canceller-1' },
      };

      getBudgetChatMessagesService.getChatMessages.mockResolvedValueOnce(
        new Array(10).fill({ message: 'hi' }),
      );
      getBudgetOffersService.getApprovedOffer.mockResolvedValueOnce({
        price: { totalValue: 1000 },
      });
      calculateRefoundPercentageService.handle.mockReturnValue(10); // 10%
      getBudgetOffersService.getPublicOffers.mockResolvedValueOnce([]);
      getTattooPhotosService.getByTattooId.mockResolvedValue([]);
      getTattooMinimalService.getMinimal.mockResolvedValue({
        id: 'tattoo-inspired',
      } as any);
      getBudgetOffersService.getLastValidOffer.mockResolvedValue(null);
      getBudgetSchedulesService.getLastValidSchedule.mockResolvedValue(null);
      getArtistAddressService.get.mockResolvedValue({
        address: 'street',
      } as any);
      budgetHasNotificationService.verify.mockResolvedValue(true);
      clientService.getClientDto.mockResolvedValue({ id: 'user-dto' } as any);

      const result = await service.toBudgetDto(
        'other-artist-id',
        mockBudget as any,
        true,
        true,
      );

      expect(result).toBeDefined();
      expect(mockBudget.status).toEqual(BudgetStatus.OPEN);
      expect(getBudgetChatMessagesService.getChatMessages).toHaveBeenCalledWith(
        'other-artist-id',
        'budget-1',
        0,
      );
    });
  });
});
