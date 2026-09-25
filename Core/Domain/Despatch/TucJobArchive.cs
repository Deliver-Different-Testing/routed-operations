// Slim EF entity for [dbo].[tucJobArchive]. Only the columns the
// Historic Archive Upload feature writes are surfaced here - the legacy
// table has 268 columns and the Power Tools scaffold would drag in
// hundreds of relationships we do not need. Reads of archive rows for
// reporting go through the RunViewer / Configurator surfaces, not this
// entity.
//
// Key fact about the target: `ucjbID` is NOT identity on tucJobArchive
// (unlike tucJob). Callers MUST supply the value. See
// HistoricArchiveService.CommitAsync for the reserved offset scheme.
//
// Every historic-import row is stamped with the "billing-sentinel"
// recipe so the row is never picked up by any invoice / BCTI /
// settlement process. See the plan file for the full recipe rationale.
#nullable disable

using System.ComponentModel.DataAnnotations.Schema;

namespace RoutedOperations.Core.Domain.Despatch;

[Table("tucJobArchive")]
public class TucJobArchive
{
    // ---- Identity + core job shape ----
    [Column("ucjbID")]                public int      UcjbId { get; set; }
    [Column("ucjbNumber")]            public string   UcjbNumber { get; set; }
    [Column("ucjbDate")]              public DateTime UcjbDate { get; set; }
    [Column("ucjbTime")]              public DateTime? UcjbTime { get; set; }
    [Column("ucjbType")]              public double?  UcjbType { get; set; }
    [Column("ucjbClientID")]          public int?     UcjbClientId { get; set; }
    [Column("ucjbContact")]           public string   UcjbContact { get; set; }
    [Column("ucjbChargeType")]        public double?  UcjbChargeType { get; set; }
    [Column("ucjbAmount")]            public decimal? UcjbAmount { get; set; }
    [Column("ucjbSpeed")]             public int?     UcjbSpeed { get; set; }
    [Column("ucjbFrom")]              public int?     UcjbFrom { get; set; }
    [Column("ucjbFromAddr")]          public string   UcjbFromAddr { get; set; }
    [Column("ucjbTo")]                public int?     UcjbTo { get; set; }
    [Column("ucjbToAddr")]            public string   UcjbToAddr { get; set; }
    [Column("ucjbSize")]              public int?     UcjbSize { get; set; }
    [Column("ucjbQty")]               public short?   UcjbQty { get; set; }
    [Column("ucjbWeight")]            public double?  UcjbWeight { get; set; }
    [Column("ucjbCourierID")]         public int?     UcjbCourierId { get; set; }
    [Column("ucjbClientRefa")]        public string   UcjbClientRefa { get; set; }
    [Column("ucjbClientRefb")]        public string   UcjbClientRefb { get; set; }
    [Column("ucjbClientRefc")]        public string   UcjbClientRefc { get; set; }
    [Column("ucjbOurRef")]            public string   UcjbOurRef { get; set; }
    [Column("ucjbClientCode")]        public string   UcjbClientCode { get; set; }
    [Column("ucjbPODName")]           public string   UcjbPodname { get; set; }
    [Column("ucjbNotes")]             public string   UcjbNotes { get; set; }
    [Column("ucjbContactPhone")]      public string   UcjbContactPhone { get; set; }
    [Column("ucjbOpID")]              public int?     UcjbOpId { get; set; }

    // ---- Extra contact fields exposed by the historic uploader so
    // pickup + delivery parties are not collapsed into a single Company
    // column (Steve 2026-09-03). All nullable.
    [Column("PickUpFromContact")]     public string   PickUpFromContact { get; set; }
    [Column("PickUpFromPhone")]       public string   PickUpFromPhone { get; set; }
    [Column("DeliverToContact")]      public string   DeliverToContact { get; set; }
    [Column("DeliverToPhone")]        public string   DeliverToPhone { get; set; }

    // ---- Long-form notes + descriptive fields ----
    [Column("ClientNotes")]           public string   ClientNotes { get; set; }
    [Column("InternalNotes")]         public string   InternalNotes { get; set; }
    [Column("Connote")]               public string   Connote { get; set; }
    [Column("Barcode")]               public string   Barcode { get; set; }
    [Column("CustomJobName")]         public string   CustomJobName { get; set; }
    [Column("RunName")]               public string   RunName { get; set; }
    [Column("ScheduleName")]          public string   ScheduleName { get; set; }

    // ---- Timing / milestone fields ----
    [Column("RequiredDeliveryTime")]  public DateTime? RequiredDeliveryTime { get; set; }
    [Column("DeliverByTime")]         public DateTime? DeliverByTime { get; set; }
    [Column("PickupArrivalTime")]     public DateTime? PickupArrivalTime { get; set; }
    [Column("DeliveryArrivalTime")]   public DateTime? DeliveryArrivalTime { get; set; }

    // ---- Extra reference columns (TextRef1..4 varchar 50, NumRef1..4 int) ----
    [Column("TextRef1")]              public string   TextRef1 { get; set; }
    [Column("TextRef2")]              public string   TextRef2 { get; set; }
    [Column("TextRef3")]              public string   TextRef3 { get; set; }
    [Column("TextRef4")]              public string   TextRef4 { get; set; }
    [Column("NumRef1")]               public int?     NumRef1 { get; set; }
    [Column("NumRef2")]               public int?     NumRef2 { get; set; }
    [Column("NumRef3")]               public int?     NumRef3 { get; set; }
    [Column("NumRef4")]               public int?     NumRef4 { get; set; }

    // ---- Completed-job defaults (all historic rows) ----
    [Column("ucjbStatus")]            public int?     UcjbStatus { get; set; }
    [Column("ucjbJobDone")]           public bool     UcjbJobDone { get; set; }
    [Column("ucjbVoid")]              public bool     UcjbVoid { get; set; }
    [Column("ucjbComplTime")]         public DateTime? UcjbComplTime { get; set; }
    [Column("ucjbMonth")]             public byte?    UcjbMonth { get; set; }
    [Column("ucjbYear")]              public short?   UcjbYear { get; set; }

    // ---- Legacy NOT NULL bit columns without defaults (must be set to
    // avoid SqlException 515 on insert). All safely default to false for
    // historic rows.
    [Column("ucjbCBD")]               public bool     UcjbCbd { get; set; }
    [Column("ucjbVan")]               public bool     UcjbVan { get; set; }
    [Column("ucjbReturn")]            public bool     UcjbReturn { get; set; }
    [Column("ucjbAttention")]         public bool     UcjbAttention { get; set; }
    [Column("ucjbPaged")]             public bool     UcjbPaged { get; set; }

    // ---- Billing sentinel columns (stamped so pickers exclude us) ----
    [Column("ucjbInvoiceNo")]         public int?     UcjbInvoiceNo { get; set; }
    [Column("InvoiceProcessID")]      public int?     InvoiceProcessId { get; set; }
    [Column("JournalHeaderID")]       public int?     JournalHeaderId { get; set; }
    [Column("AgentBctiRunId")]        public int?     AgentBctiRunId { get; set; }
    [Column("CourierSettlementBatchId")] public int?  CourierSettlementBatchId { get; set; }

    // ---- Provenance / audit ----
    [Column("SourceID")]              public int?     SourceId { get; set; }
    [Column("InternalStatus")]        public int?     InternalStatus { get; set; }
    [Column("RatedManually")]         public bool     RatedManually { get; set; }
    [Column("AutoDespatch")]          public bool?    AutoDespatch { get; set; }
    [Column("CreatedTime")]           public DateTime? CreatedTime { get; set; }
    [Column("CreatedTimeUtc")]        public DateTime? CreatedTimeUtc { get; set; }

    // ---- Money pass-through columns from the CSV ----
    [Column("CourierPayment")]        public decimal? CourierPayment { get; set; }
    [Column("CourierPercentage")]     public decimal? CourierPercentage { get; set; }
    [Column("CourierFuel")]           public decimal? CourierFuel { get; set; }
    [Column("CourierBonus")]          public decimal? CourierBonus { get; set; }
    [Column("FuelSurchargeAmount")]   public decimal? FuelSurchargeAmount { get; set; }
    [Column("PPDAmount")]             public decimal? PpdAmount { get; set; }
    [Column("PPDExclusiveAmount")]    public decimal? PpdExclusiveAmount { get; set; }
    [Column("RawBaseAmount")]         public decimal? RawBaseAmount { get; set; }
    [Column("GSTRate")]               public decimal? GstRate { get; set; }

    // ---- Address bag (denormalised, populated from CSV columns) ----
    [Column("PickupAddressLine1")]    public string   PickupAddressLine1 { get; set; }
    [Column("PickupAddressLine2")]    public string   PickupAddressLine2 { get; set; }
    [Column("PickupAddressLine3")]    public string   PickupAddressLine3 { get; set; }
    [Column("PickupAddressLine4")]    public string   PickupAddressLine4 { get; set; }
    [Column("PickupAddressLine5")]    public string   PickupAddressLine5 { get; set; }
    [Column("PickupAddressLine6")]    public string   PickupAddressLine6 { get; set; }
    [Column("PickupAddressLine7")]    public string   PickupAddressLine7 { get; set; }
    [Column("DeliveryAddressLine1")]  public string   DeliveryAddressLine1 { get; set; }
    [Column("DeliveryAddressLine2")]  public string   DeliveryAddressLine2 { get; set; }
    [Column("DeliveryAddressLine3")]  public string   DeliveryAddressLine3 { get; set; }
    [Column("DeliveryAddressLine4")]  public string   DeliveryAddressLine4 { get; set; }
    [Column("DeliveryAddressLine5")]  public string   DeliveryAddressLine5 { get; set; }
    [Column("DeliveryAddressLine6")]  public string   DeliveryAddressLine6 { get; set; }
    [Column("DeliveryAddressLine7")]  public string   DeliveryAddressLine7 { get; set; }

    // ---- Lat/long (nullable; historic rows can ship without coords) ----
    [Column("PickUpLatitude")]        public decimal? PickUpLatitude { get; set; }
    [Column("PickUpLongitude")]       public decimal? PickUpLongitude { get; set; }
    [Column("DeliveryLatitude")]      public decimal? DeliveryLatitude { get; set; }
    [Column("DeliveryLongitude")]     public decimal? DeliveryLongitude { get; set; }
}
