// Newtonsoft.Json converter for Dictionary<string, string?> that skips
// the global CamelCasePropertyNamesContractResolver's ProcessDictionaryKeys
// step so keys round-trip verbatim in both directions.
//
// Program.cs configures AddNewtonsoftJson with
// CamelCasePropertyNamesContractResolver, whose default NamingStrategy
// sets ProcessDictionaryKeys = true. That would rewrite operator-supplied
// file headers like "JobNumber" / "Delivery Address 1" as "jobNumber" /
// "delivery Address 1" on the wire, and the server's mapping lookup
// (which keys on the original header name from the operator's Map
// Columns selection) would miss every row.
//
// This converter is scoped to individual [JsonProperty(ItemConverterType =
// typeof(PreserveKeysDictConverter))] annotations on HistoricArchive DTOs;
// nothing else in the codebase is affected.

using Newtonsoft.Json;

namespace RoutedOperations.Core.Application.Utilities;

public class PreserveKeysDictConverter : JsonConverter<Dictionary<string, string?>>
{
    public override void WriteJson(JsonWriter writer, Dictionary<string, string?>? value, JsonSerializer serializer)
    {
        writer.WriteStartObject();
        if (value != null)
        {
            foreach (var kv in value)
            {
                writer.WritePropertyName(kv.Key);
                if (kv.Value == null) writer.WriteNull();
                else writer.WriteValue(kv.Value);
            }
        }
        writer.WriteEndObject();
    }

    public override Dictionary<string, string?>? ReadJson(
        JsonReader reader,
        Type objectType,
        Dictionary<string, string?>? existingValue,
        bool hasExistingValue,
        JsonSerializer serializer)
    {
        if (reader.TokenType == JsonToken.Null) return null;
        if (reader.TokenType != JsonToken.StartObject)
            throw new JsonSerializationException($"Expected StartObject, got {reader.TokenType}.");

        var dict = new Dictionary<string, string?>(StringComparer.Ordinal);
        while (reader.Read())
        {
            if (reader.TokenType == JsonToken.EndObject) return dict;
            if (reader.TokenType != JsonToken.PropertyName)
                throw new JsonSerializationException($"Expected PropertyName, got {reader.TokenType}.");
            var key = (string)reader.Value!;
            if (!reader.Read())
                throw new JsonSerializationException("Unexpected end of stream reading dictionary value.");
            dict[key] = reader.TokenType == JsonToken.Null ? null : Convert.ToString(reader.Value);
        }
        throw new JsonSerializationException("Unexpected end of stream reading dictionary.");
    }
}
