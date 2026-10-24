"""
Definição do Golden Set Curado da TattooPop API.
Conjunto representativo de 10 serviços para benchmark determinístico entre modelos de IA:
- 3 de Baixa Complexidade (cálculo, formatação ou lógica de domínio pura sem dependências profundas)
- 4 de Média Complexidade (injeção de 1 a 2 repositórios TypeORM com operações CRUD simples)
- 3 de Alta Complexidade (múltiplos repositórios, createQueryBuilder encadeado, transações/subqueries)
"""

from dataclasses import asdict, dataclass
from typing import Any, Dict, List
from pipeline.queue_manager import Task


@dataclass(frozen=True)
class GoldenSetItem:
    id: str
    module_name: str
    service_file: str
    spec_file: str
    complexity: str  # "low", "medium", "high"
    description: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


GOLDEN_SET: List[GoldenSetItem] = [
    # ---------------------------------------------------------
    # Baixa Complexidade (3 serviços)
    # Lógica de domínio pura, cálculo ou formatação sem repositórios
    # ---------------------------------------------------------
    GoldenSetItem(
        id="GOLDEN-001",
        module_name="admin",
        service_file="src/modules/admin/dashboard/DashboardUtils.service.ts",
        spec_file="src/modules/admin/dashboard/DashboardUtils.service.spec.ts",
        complexity="low",
        description="Cálculo e agregação numérica para gráficos de dashboard sem repositórios",
    ),
    GoldenSetItem(
        id="GOLDEN-002",
        module_name="payment",
        service_file="src/modules/payment/actions/CalculateRefoundPercentage.service.ts",
        spec_file="src/modules/payment/actions/CalculateRefoundPercentage.service.spec.ts",
        complexity="low",
        description="Cálculo de taxas de estorno baseado em data do agendamento e variáveis de ambiente",
    ),
    GoldenSetItem(
        id="GOLDEN-003",
        module_name="admin",
        service_file="src/modules/admin/tattoo/AdminAiClassifyTattoo.service.ts",
        spec_file="src/modules/admin/tattoo/AdminAiClassifyTattoo.service.spec.ts",
        complexity="low",
        description="Orquestração de classificação por visão computacional, verificação de mídia e DTO",
    ),
    # ---------------------------------------------------------
    # Média Complexidade (4 serviços)
    # Injeção de 1 a 2 repositórios TypeORM padrão com operações CRUD simples (findOne, save, softDelete)
    # ---------------------------------------------------------
    GoldenSetItem(
        id="GOLDEN-004",
        module_name="tattoo",
        service_file="src/modules/tattoo/photo/DeletePhoto.service.ts",
        spec_file="src/modules/tattoo/photo/DeletePhoto.service.spec.ts",
        complexity="medium",
        description="Operações CRUD com 1 repositório Photo (findOne, save, softDelete) e exclusão de mídia",
    ),
    GoldenSetItem(
        id="GOLDEN-005",
        module_name="admin",
        service_file="src/modules/admin/MakeAdmin.service.ts",
        spec_file="src/modules/admin/MakeAdmin.service.spec.ts",
        complexity="medium",
        description="Injeção de 2 repositórios (Admin, Client) com verificação de existência, save e custom claims",
    ),
    GoldenSetItem(
        id="GOLDEN-006",
        module_name="tattoo",
        service_file="src/modules/tattoo/details/GetSizes.service.ts",
        spec_file="src/modules/tattoo/details/GetSizes.service.spec.ts",
        complexity="medium",
        description="Consultas findOne e find com ordenação simples e conversão de entidade para DTO",
    ),
    GoldenSetItem(
        id="GOLDEN-007",
        module_name="tattoo",
        service_file="src/modules/tattoo/style/GetStyles.service.ts",
        spec_file="src/modules/tattoo/style/GetStyles.service.spec.ts",
        complexity="medium",
        description="Consultas relacionais com 2 repositórios (Style, ClientInteractStyle) usando operador In()",
    ),
    # ---------------------------------------------------------
    # Alta Complexidade (3 serviços)
    # Múltiplos repositórios injetados, createQueryBuilder encadeado, transações/subqueries
    # ---------------------------------------------------------
    GoldenSetItem(
        id="GOLDEN-008",
        module_name="address",
        service_file="src/modules/address/LocateQuery.Service.ts",
        spec_file="src/modules/address/LocateQuery.Service.spec.ts",
        complexity="high",
        description="SelectQueryBuilder encadeado dinâmico com operadores Brackets e filtros condicionais de endereço",
    ),
    GoldenSetItem(
        id="GOLDEN-009",
        module_name="address",
        service_file="src/modules/address/artist/CountArtistsInAddres.Service.ts",
        spec_file="src/modules/address/artist/CountArtistsInAddres.Service.spec.ts",
        complexity="high",
        description="Múltiplos repositórios (4), createQueryBuilder com múltiplos joins, getRawMany e agregações",
    ),
    GoldenSetItem(
        id="GOLDEN-010",
        module_name="address",
        service_file="src/modules/address/artist/SetArtistLocale.service.ts",
        spec_file="src/modules/address/artist/SetArtistLocale.service.spec.ts",
        complexity="high",
        description="Múltiplos repositórios (4), cascata de softDelete, findOne, save e updates em transação/relacionamentos",
    ),
]


def get_golden_set() -> List[GoldenSetItem]:
    """Retorna a lista completa dos 10 serviços do Golden Set."""
    return list(GOLDEN_SET)


def get_golden_set_by_complexity(complexity: str) -> List[GoldenSetItem]:
    """Filtra serviços do Golden Set pela complexidade ('low', 'medium', 'high')."""
    return [item for item in GOLDEN_SET if item.complexity == complexity]


def create_golden_tasks(project_path: str, max_attempts: int = 3) -> List[Task]:
    """Cria instâncias de Task prontas para a fila de execução do benchmark."""
    tasks = []
    for item in GOLDEN_SET:
        task = Task(
            id=item.id,
            project_path=str(project_path),
            service_file=item.service_file,
            spec_file=item.spec_file,
            module_name=item.module_name,
            profile="nestjs",
            status="pending",
            attempts=0,
            max_attempts=max_attempts,
            error_log=None,
        )
        tasks.append(task)
    return tasks
