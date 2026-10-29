import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LoginService } from './Login.service';
import { Client } from 'model/users/Client.entity';
import { Artist } from 'model/users/Artist.entity';
import { GetArtistAddressService } from 'modules/address/artist/GetArtistAddress.service';
import { ViewAddressService } from 'modules/address/ViewAddressService';
import { StripeService } from 'modules/payment/stripe/StripeService';
import { LegalService } from 'modules/legal/Legal.service';
import {
  CHOOSE_TYPE,
  HOME,
  PRIVACY_POLICY,
  TERMS_OF_USE,
} from 'constants/RoutesConstants';
import { LegalDocumentType } from 'enums/LegalDocumentType';

describe('LoginService', () => {
  let service: LoginService;
  let clientRepository: any;
  let artistRepository: any;
  let getArtistAddressService: any;
  let viewAddressService: any;
  let stripeService: any;
  let legalService: any;

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
    clientRepository = createMockRepository();
    artistRepository = createMockRepository();
    getArtistAddressService = {
      hasAddress: jest.fn(),
    };
    viewAddressService = {
      checkIfClientHasViewLocation: jest.fn(),
    };
    stripeService = {
      createCustomer: jest.fn(),
    };
    legalService = {
      getFirstPendingDocumentType: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
        {
          provide: GetArtistAddressService,
          useValue: getArtistAddressService,
        },
        {
          provide: ViewAddressService,
          useValue: viewAddressService,
        },
        {
          provide: StripeService,
          useValue: stripeService,
        },
        {
          provide: LegalService,
          useValue: legalService,
        },
      ],
    }).compile();

    service = module.get<LoginService>(LoginService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getInitialRoute', () => {
    it('should return CHOOSE_TYPE when neither client nor artist is found', async () => {
      artistRepository.findOne.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue(null);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(CHOOSE_TYPE);
    });

    it('should return PRIVACY_POLICY when pending document is PRIVACY_POLICY', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(
        LegalDocumentType.PRIVACY_POLICY,
      );
      // Mock client to exist so we pass the initial check
      clientRepository.findOne.mockResolvedValue({ id: 'user-id' } as any);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(PRIVACY_POLICY);
    });

    it('should return TERMS_OF_USE when pending document is TERMS_OF_USE', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(
        LegalDocumentType.TERMS_OF_USE,
      );
      // Mock client to exist so we pass the initial check
      clientRepository.findOne.mockResolvedValue({ id: 'user-id' } as any);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(TERMS_OF_USE);
    });

    it('should return CHOOSE_TYPE when client exists but username is missing', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue({ username: '' } as any);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(CHOOSE_TYPE);
    });

    it('should return CHOOSE_TYPE when client exists but email is apple relay', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue({
        username: 'user',
        email: 'test@privaterelay.appleid.com',
      } as any);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(CHOOSE_TYPE);
    });

    it('should return CHOOSE_TYPE when client exists but cpf is missing', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue({
        username: 'user',
        email: 'test@test.com',
        cpf: null,
      } as any);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(CHOOSE_TYPE);
    });

    it('should return HOME when client exists, is valid, and has location', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue({
        username: 'user',
        email: 'test@test.com',
        cpf: '12345678900',
      } as any);
      viewAddressService.checkIfClientHasViewLocation.mockResolvedValue(true);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(HOME);
      expect(clientRepository.update).toHaveBeenCalled();
    });

    it('should return CHOOSE_TYPE when client exists, is valid, but has no location', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue({
        username: 'user',
        email: 'test@test.com',
        cpf: '12345678900',
      } as any);
      viewAddressService.checkIfClientHasViewLocation.mockResolvedValue(false);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(CHOOSE_TYPE);
    });

    it('should return HOME when artist exists and has address', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue(null);
      artistRepository.findOne.mockResolvedValue({ id: 'artist-id' } as any);
      getArtistAddressService.hasAddress.mockResolvedValue(true);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(HOME);
    });

    it('should return CHOOSE_TYPE when artist exists but has no address', async () => {
      legalService.getFirstPendingDocumentType.mockResolvedValue(null);
      clientRepository.findOne.mockResolvedValue(null);
      artistRepository.findOne.mockResolvedValue({ id: 'artist-id' } as any);
      getArtistAddressService.hasAddress.mockResolvedValue(false);

      const result = await service.getInitialRoute('user-id');

      expect(result).toBe(CHOOSE_TYPE);
    });
  });

  describe('buildResult', () => {
    it('should return HOME when hasLocationSet is true', async () => {
      const result = service.buildResult(true, false);
      expect(result).toBe(HOME);
    });

    it('should return CHOOSE_TYPE when hasLocationSet is false', async () => {
      const result = service.buildResult(false, false);
      expect(result).toBe(CHOOSE_TYPE);
    });
  });
});
