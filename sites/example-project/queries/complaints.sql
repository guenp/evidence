select year(created_date)::int as Year, count(*)::int as Complaints
  from sample_data.nyc.service_requests
  where Year < 2023
  and agency_name = 'New York City Police Department'
  group by 1
  order by 1;